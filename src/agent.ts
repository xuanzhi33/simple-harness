import type { Config } from "./config.ts";
import type { ChatCompletionResponse, ChatMessage, Tool } from "./types.ts";

const FETCH_TIMEOUT_MS = 60_000;

export interface AgentOptions {
  config: Config;
  systemPrompt: string;
  temperature?: number; // 默认 0
}

export class Agent {
  readonly messages: ChatMessage[] = [];
  private readonly config: Config;
  private readonly systemPrompt: string;
  private readonly tools: Tool[];
  private readonly temperature: number;

  constructor(options: AgentOptions, tools: Tool[]) {
    this.config = options.config;
    this.systemPrompt = options.systemPrompt;
    this.tools = tools;
    this.temperature = options.temperature ?? 0;
    this.messages.push({ role: "system", content: this.systemPrompt });
  }

  // 一轮完整对话(含工具循环);历史在 messages 中累积,REPL 多轮复用
  async chat(userText: string): Promise<string> {
    this.messages.push({ role: "user", content: userText });

    for (let i = 0; i < this.config.maxIterations; i++) {
      const msg = (await this.complete()).choices?.[0]?.message;
      if (!msg) throw new Error("Empty response from API");

      const toolCalls = msg.tool_calls ?? [];
      // reasoning 打印到 stderr(截断),同时必须回传给 API:
      // DeepSeek 规范——携带 tools 参数的请求需完整回传 reasoning_content,
      // 否则后续请求 400(OpenRouter 网关的 reasoning 字段是它的别名)
      const reasoning = msg.reasoning ?? msg.reasoning_content;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls,
      };
      if (reasoning) {
        assistantMsg.reasoning_content = reasoning;
        const clipped = reasoning.length > 2000 ? reasoning.slice(0, 2000) + "..." : reasoning;
        console.error(`[reasoning] ${clipped}`);
      }

      this.messages.push(assistantMsg);

      if (toolCalls.length === 0) return msg.content ?? "";

      await Promise.all(
        toolCalls.map(async (tc) => {
          let result: string;
          try {
            const args = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
            const tool = this.tools.find((t) => t.name === tc.function.name);
            // 输入日志(stderr,与 [reasoning] 风格一致)
            const argText = JSON.stringify(args);
            const argClipped = argText.length > 200 ? argText.slice(0, 200) + "..." : argText;
            console.error(`[${tc.function.name}] ${argClipped}`);
            result = tool ? await tool.execute(args) : `Unknown tool: ${tc.function.name}`;
            // 输出摘要(前 8 行,完整结果仍进消息历史)
            const lines = result.split("\n");
            const shown = lines.slice(0, 8).join("\n");
            const more = lines.length > 8 ? `\n  …(${lines.length} lines)` : "";
            console.error(`[${tc.function.name} →] ${shown}${more}`);
          } catch (e) {
            result = `Error: ${(e as Error).message}`;
            console.error(`[${tc.function.name} ✗] ${(e as Error).message}`);
          }
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }),
      );
    }
    return `Reached max iterations (${this.config.maxIterations}) without a final answer.`;
  }

  private async complete(): Promise<ChatCompletionResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.messages,
      tools: this.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      temperature: this.temperature,
      tool_choice: "auto",
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
      const text = await res.text();
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { error?: { message?: string } };
          if (j?.error?.message) detail += `: ${j.error.message}`;
        } catch {
          // body 非 JSON,忽略
        }
        throw new Error(detail);
      }
      return JSON.parse(text) as ChatCompletionResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}
