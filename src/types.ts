// OpenAI Chat Completions 格式类型定义(零转换,直接透传)

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[]; // 仅 assistant
  reasoning_content?: string; // 仅 assistant: 思考内容,DeepSeek 工具调用时必须回传
  tool_call_id?: string; // 仅 tool
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments 为 JSON 字符串
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema,手写
  execute(args: Record<string, unknown>): Promise<string>;
}

// API 响应(仅用到字段)
export interface ChatCompletionResponse {
  choices?: {
    message: {
      content: string | null;
      reasoning?: string | null; // OpenRouter 网关
      reasoning_content?: string | null; // 别名
      tool_calls?: ToolCall[];
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}
