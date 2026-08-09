import type { Config } from "./config.ts";
import type { ChatMessage, Tool, ToolCall, ToolResult, Usage } from "./types.ts";
import { gray, green, italicGray, red, tagGreen, tagRed, tagSkyBlue, tagYellow, yellow } from "./color.ts";
import { isRisky } from "./risk.ts";

const FETCH_TIMEOUT_MS = 60_000;
const MAX_ITERATIONS = 20; // 写死: 单轮对话的工具调用上限

// 上下文压缩提示词(参考 pi 的 compaction 实现:结构化总结,便于后续 LLM 续作)
const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## User Messages
- [List ALL user messages that are not tool results, verbatim or near-verbatim. These are critical for understanding the user's feedback and changing intent.]

## Next Steps
1. [Ordered list of what should happen next. If there is a next step, include direct quotes from the most recent conversation showing exactly what task was being worked on and where it left off.]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export interface AgentOptions {
  config: Config;
  systemPrompt: string;
  temperature?: number; // 默认 0
  // 流式回调: reasoning 文本自带 "\n[reasoning] " 前缀与结尾换行
  onStream?: (type: "content" | "reasoning", text: string) => void;
  // 每次消息 push 后触发,用于会话持久化(入参为当前全部消息)
  onPersist?: (messages: ChatMessage[]) => void;
}

interface StreamResult {
  content: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  usage?: Usage; // OpenRouter 流式响应末尾 usage chunk(可能缺失)
}

interface ToolCallAcc {
  id?: string;
  name?: string;
  args?: string;
}

export class Agent {
  readonly messages: ChatMessage[] = [];
  private readonly config: Config;
  private readonly systemPrompt: string;
  private readonly tools: Tool[];
  private readonly temperature: number;
  private readonly onStream?: (type: "content" | "reasoning", text: string) => void;
  private readonly onPersist?: (messages: ChatMessage[]) => void;

  constructor(options: AgentOptions, tools: Tool[]) {
    this.config = options.config;
    this.systemPrompt = options.systemPrompt;
    this.tools = tools;
    this.temperature = options.temperature ?? 0;
    this.onStream = options.onStream;
    this.onPersist = options.onPersist;
    this.messages.push({ role: "system", content: this.systemPrompt });
  }

  // 统一入口: push 消息并通知持久化
  private push(msg: ChatMessage): void {
    this.messages.push(msg);
    this.onPersist?.(this.messages);
  }

  // 手动上下文压缩: 将历史(不含 system)总结为一条 context summary,
  // 替换全部旧对话(不保留任何原始消息),session.jsonl 同步清空旧记录。
  // 返回 summary 文本。
  async compact(): Promise<string> {
    const system = this.messages[0];
    const history = this.messages.slice(1);
    if (history.length === 0) throw new Error("No history to compact");

    const tokensBefore = history.reduce((n, m) => n + estimateTokens(m), 0);
    const summary = await this.summarize(history);

    // messages 为 readonly 引用,用 splice 原地重建(不允许重新赋值)
    // 只保留 system + summary,旧对话全部移除,持久化后文件即精简后的历史
    this.messages.splice(
      1,
      this.messages.length - 1,
      { role: "user", content: `[Context summary of earlier conversation - the compacted history is replaced by this summary. Continue the work based on it.]\n\n${summary}` },
    );
    this.onPersist?.(this.messages);

    const tokensAfter = this.messages.slice(1).reduce((n, m) => n + estimateTokens(m), 0);
    console.error(`${tagGreen(" \u2705 ")} ${green(`compacted: ~${tokensBefore} → ~${tokensAfter} tokens`)}`);
    return summary;
  }

  // 独立的总结请求: 非流式、不带 tools,防止模型继续对话或调用工具
  private async summarize(history: ChatMessage[]): Promise<string> {
    const conversationText = history
      .map((m) => `${m.role === "tool" ? "tool result" : m.role}: ${m.content ?? ""}`)
      .join("\n\n");
    const prompt = `<conversation>\n${conversationText}\n</conversation>\n\n${SUMMARIZATION_PROMPT}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          ...this.config.headers,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          stream: false,
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { error?: { message?: string } };
          if (j?.error?.message) detail += `: ${j.error.message}`;
        } catch {
          // body 非 JSON,忽略
        }
        throw new Error(detail);
      }
      const j = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: Usage;
      };
      if (j.usage) displayUsage(j.usage); // 总结请求同样计入费用,顺带显示
      const content = j.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty summary response");
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  // 一轮完整对话(含工具循环);历史在 messages 中累积,REPL 多轮复用
  async chat(userText: string): Promise<string> {
    this.push({ role: "user", content: userText });

    const totalUsage: Usage = {};
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { content, reasoning, toolCalls, usage } = await this.streamComplete();
      if (usage) accumulateUsage(totalUsage, usage);

      // 无工具调用时不设置 tool_calls 字段: DeepSeek 后端拒绝空数组
      // ("Expected an array with minimum length 1")
      const assistantMsg: ChatMessage = { role: "assistant", content: content || null };
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      // DeepSeek 规范——携带 tools 参数的请求需完整回传 reasoning_content,
      // 否则后续请求 400(OpenRouter 网关的 reasoning 字段是它的别名)
      if (reasoning) assistantMsg.reasoning_content = reasoning;

      this.push(assistantMsg);

      if (toolCalls.length === 0) {
        if (Object.keys(totalUsage).length > 0) displayUsage(totalUsage);
        return content;
      }

      await Promise.all(
        toolCalls.map(async (tc) => {
          let result: ToolResult;
          let display = tc.function.arguments; // 解析失败时的回退
          try {
            const args = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
            if (typeof args.command === "string") display = args.command;
            else display = JSON.stringify(args);
            const tool = this.tools.find((t) => t.name === tc.function.name);
            result = tool
              ? await tool.execute(args)
              : { output: `Unknown tool: ${tc.function.name}`, code: 1 };
          } catch (e) {
            result = { output: `Error: ${(e as Error).message}`, code: 1 };
          }
          // 命令按成败染绿/红(执行后打印,故可知退出码),标签底色跟随成败;
          // 高风险命令(写 git / 装依赖 / 网络 / 代码内执行)标黄,标签带 ⚠️
          const failed = result.code !== 0;
          const risky = !failed && isRisky(display);
          const color = failed ? red : risky ? yellow : green;
          const tag = failed ? tagRed : risky ? tagYellow : tagGreen; // 底色: 红/黄(高风险)/绿
          const icon = risky ? " ⚠️ " : " 💻 ";
          console.error(`${tag(icon)} ${color(display)}`);
          // 输出摘要: 无标签,灰色(与思考一致),行数提示斜体灰
          const lines = result.output.split("\n");
          const shown = lines.slice(0, 8).join("\n");
          const more = lines.length > 8 ? `\n  ${italicGray(`…(${lines.length} lines)`)}` : "";
          console.error(gray(shown) + more);
          this.push({ role: "tool", tool_call_id: tc.id, content: result.output });
        }),
      );
    }
    if (Object.keys(totalUsage).length > 0) displayUsage(totalUsage);
    return `Reached max iterations (${MAX_ITERATIONS}) without a final answer.`;
  }

  // 流式请求 + SSE 解析,累积出完整 message(与旧非流式响应结构一致)
  private async streamComplete(): Promise<StreamResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.messages,
      tools: this.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      temperature: this.temperature,
      tool_choice: "auto",
      stream: true,
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { error?: { message?: string } };
          if (j?.error?.message) detail += `: ${j.error.message}`;
        } catch {
          // body 非 JSON,忽略
        }
        throw new Error(detail);
      }
      return await readStream(res, this.onStream);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readStream(
  res: Response,
  onStream?: (type: "content" | "reasoning", text: string) => void,
): Promise<StreamResult> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let contentStarted = false;
  let reasoning: string | undefined;
  let reasoningStarted = false;
  let reasoningEnded = false;
  const toolAcc = new Map<number, ToolCallAcc>();
  let usage: Usage | undefined; // 流式末尾 usage chunk(OpenRouter 在 [DONE] 前发送)

  const emitReasoning = (t: string) => {
    if (!reasoningStarted) {
      onStream?.("reasoning", `\n${tagSkyBlue(" 🤔 ")} `);
      reasoningStarted = true;
    }
    onStream?.("reasoning", gray(t));
  };
  // reasoning 结束后立即换行(content/tool_calls 出现时触发,流结束兜底)
  const endReasoning = () => {
    if (reasoningStarted && !reasoningEnded) {
      onStream?.("reasoning", "\n");
      reasoningEnded = true;
    }
  };
  // content 流结束后补一个换行,保证末尾换行
  const endContent = () => {
    if (contentStarted && !content.endsWith("\n")) {
      onStream?.("content", "\n");
    }
  };

  try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break outer;
        let chunk: { choices?: { delta?: Record<string, unknown> }[]; usage?: Usage } | undefined;
        try {
          chunk = JSON.parse(data) as { choices?: { delta?: Record<string, unknown> }[]; usage?: Usage };
        } catch {
          continue; // 忽略非 JSON 行
        }
        if (chunk?.usage) usage = chunk.usage; // usage chunk 的 choices 为空数组,delta 为 undefined
        const delta = chunk?.choices?.[0]?.delta;
        if (!delta) continue;
        const r = (delta.reasoning ?? delta.reasoning_content) as string | undefined;
        if (r) {
          reasoning = (reasoning ?? "") + r;
          emitReasoning(r);
        }
        const c = delta.content as string | undefined;
        if (c) {
          endReasoning();
          if (!contentStarted && !reasoningStarted) {
            // 无 reasoning 时,首个 content 前补换行(有 reasoning 则前缀已含)
            onStream?.("content", "\n");
          }
          contentStarted = true;
          content += c;
          onStream?.("content", c);
        }
        if (Array.isArray(delta.tool_calls)) {
          endReasoning();
          for (const tc of delta.tool_calls as {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[]) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) ?? {};
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = (cur.name ?? "") + tc.function.name;
            if (tc.function?.arguments) cur.args = (cur.args ?? "") + tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }
      }
    }
  } finally {
    endReasoning();
    endContent();
  }

  const toolCalls: ToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id ?? "",
      type: "function" as const,
      function: { name: v.name ?? "", arguments: v.args ?? "{}" },
    }));

  return { content, reasoning, toolCalls, usage };
}

// 累计多次 API 调用的 usage(缺失字段保持 undefined,避免被 0 污染显示)
function accumulateUsage(total: Usage, u: Usage): void {
  if (typeof u.prompt_tokens === "number") total.prompt_tokens = (total.prompt_tokens ?? 0) + u.prompt_tokens;
  if (typeof u.completion_tokens === "number") total.completion_tokens = (total.completion_tokens ?? 0) + u.completion_tokens;
  if (typeof u.cost === "number") total.cost = (total.cost ?? 0) + u.cost;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number") {
    total.prompt_tokens_details ??= {};
    total.prompt_tokens_details.cached_tokens = (total.prompt_tokens_details.cached_tokens ?? 0) + cached;
  }
}

// 仅在最终回答末尾显示 usage: ↑输入 ↓输出 · 缓存率(三位小数) · 价格(缺失字段不显示)
function displayUsage(u: Usage): void {
  const parts: string[] = [];
  if (typeof u.prompt_tokens === "number") parts.push(`↑${u.prompt_tokens}`);
  if (typeof u.completion_tokens === "number") parts.push(`↓${u.completion_tokens}`);
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number" && cached > 0 && typeof u.prompt_tokens === "number" && u.prompt_tokens > 0) {
    parts.push(`cache ${((cached / u.prompt_tokens) * 100).toFixed(3)}%`);
  }
  if (typeof u.cost === "number") {
    const cost = u.cost.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    parts.push(`$${cost}`);
  }
  if (parts.length === 0) return;
  console.error(`${tagSkyBlue(" 📊 ")} ${gray(parts.join(" · "))}`);
}

// 粗略 token 估算(chars/4),仅用于 compact 前后对比显示
function estimateTokens(m: ChatMessage): number {
  const content = m.content ?? "";
  const toolArgs =
    m.tool_calls?.reduce((n, tc) => n + tc.function.name.length + (tc.function.arguments?.length ?? 0), 0) ?? 0;
  return Math.ceil((content.length + toolArgs) / 4);
}
