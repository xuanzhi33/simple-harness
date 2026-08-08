import type { Config } from "./config.ts";
import type { ChatMessage, Tool, ToolCall, ToolResult } from "./types.ts";
import { gray, green, red, tagCyan, tagSkyBlue } from "./color.ts";

const FETCH_TIMEOUT_MS = 60_000;

export interface AgentOptions {
  config: Config;
  systemPrompt: string;
  temperature?: number; // 默认 0
  // 流式回调: reasoning 文本自带 "\n[reasoning] " 前缀与结尾换行
  onStream?: (type: "content" | "reasoning", text: string) => void;
}

interface StreamResult {
  content: string;
  reasoning?: string;
  toolCalls: ToolCall[];
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

  constructor(options: AgentOptions, tools: Tool[]) {
    this.config = options.config;
    this.systemPrompt = options.systemPrompt;
    this.tools = tools;
    this.temperature = options.temperature ?? 0;
    this.onStream = options.onStream;
    this.messages.push({ role: "system", content: this.systemPrompt });
  }

  // 一轮完整对话(含工具循环);历史在 messages 中累积,REPL 多轮复用
  async chat(userText: string): Promise<string> {
    this.messages.push({ role: "user", content: userText });

    for (let i = 0; i < this.config.maxIterations; i++) {
      const { content, reasoning, toolCalls } = await this.streamComplete();

      // 无工具调用时不设置 tool_calls 字段: DeepSeek 后端拒绝空数组
      // ("Expected an array with minimum length 1")
      const assistantMsg: ChatMessage = { role: "assistant", content: content || null };
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      // DeepSeek 规范——携带 tools 参数的请求需完整回传 reasoning_content,
      // 否则后续请求 400(OpenRouter 网关的 reasoning 字段是它的别名)
      if (reasoning) assistantMsg.reasoning_content = reasoning;

      this.messages.push(assistantMsg);

      if (toolCalls.length === 0) return content;

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
          // 命令按成败染绿/红(执行后打印,故可知退出码)
          const failed = result.code !== 0;
          const color = failed ? red : green;
          console.error(`${tagCyan(" BASH ")} ${color(display)}`);
          // 输出摘要(前 8 行,完整结果仍进消息历史)
          const lines = result.output.split("\n");
          const shown = lines.slice(0, 8).join("\n");
          const more = lines.length > 8 ? `\n  …(${lines.length} lines)` : "";
          console.error(`${tagCyan(" BASH → ")} ${color(shown)}${more}`);
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: result.output });
        }),
      );
    }
    return `Reached max iterations (${this.config.maxIterations}) without a final answer.`;
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
    if (this.config.reasoningEffort) body.reasoning = { effort: this.config.reasoningEffort };

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

  const emitReasoning = (t: string) => {
    if (!reasoningStarted) {
      onStream?.("reasoning", `\n${tagSkyBlue(" REASONING ")} `);
      reasoningStarted = true;
    }
    onStream?.("reasoning", gray(t));
  };
  // reasoning 结束后立即换行(content/tool_calls 出现时触发,流结束兕底)
  const endReasoning = () => {
    if (reasoningStarted && !reasoningEnded) {
      onStream?.("reasoning", "\n");
      reasoningEnded = true;
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
        let chunk: { choices?: { delta?: Record<string, unknown> }[] } | undefined;
        try {
          chunk = JSON.parse(data) as { choices?: { delta?: Record<string, unknown> }[] };
        } catch {
          continue; // 忽略非 JSON 行
        }
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
  }

  const toolCalls: ToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id ?? "",
      type: "function" as const,
      function: { name: v.name ?? "", arguments: v.args ?? "{}" },
    }));

  return { content, reasoning, toolCalls };
}
