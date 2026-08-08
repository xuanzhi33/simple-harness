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

      // reasoning 只打印到 stderr,不进上下文
      const reasoning = msg.reasoning ?? msg.reasoning_content;
      if (reasoning) {
        const clipped = reasoning.length > 2000 ? reasoning.slice(0, 2000) + "..." : reasoning;
        console.error(`[reasoning] ${clipped}`);
      }

      const toolCalls = msg.tool_calls ?? [];
      this.messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: toolCalls });

      if (toolCalls.length === 0) return msg.content ?? "";

      await Promise.all(
        toolCalls.map(async (tc) => {
          let result: string;
          try {
            const args = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
            const tool = this.tools.find((t) => t.name === tc.function.name);
            result = tool ? await tool.execute(args) : `Unknown tool: ${tc.function.name}`;
          } catch (e) {
            result = `Error: ${(e as Error).message}`;
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
