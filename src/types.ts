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

export interface ToolResult {
  output: string;
  code: number; // 退出码,非 0 视为失败
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema,手写
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// OpenRouter 流式响应末尾的 usage chunk(字段可选,缺失即不显示)
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cost?: number; // OpenRouter 特有:美元计价,缺失则不显示
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
