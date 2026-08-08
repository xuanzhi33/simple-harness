# simple_harness 开发计划 (v0)

> 一个 TypeScript 极简 coding agent。
> 设计理念:**极简** — 仅实现 bash 工具,所有编辑/搜索/读取操作均由模型通过 bash 完成。

## 1. 目标

- 一个**最小可用的 coding agent**:给定自然语言任务,通过 bash 工具读写文件、执行命令、完成编码任务。
- 交互方式:极简 REPL(连续多轮对话,上下文保留在内存)。
- Provider:仅兼容 **OpenRouter**(OpenAI Chat Completions 协议)。
- 零运行时依赖:纯 Node 内置模块 + fetch。

## 2. 技术栈

| 项 | 选择 |
|---|---|
| 语言 | TypeScript (strict) |
| 运行时 | Node >= 22 |
| 执行器 | `tsx`(开发运行,环境已有) |
| 依赖 | 0 个运行时依赖;devDeps 仅 `typescript` + `@types/node` |
| HTTP | 全局 `fetch` 调 `POST {baseUrl}/chat/completions` |
| 进程 | `node:child_process` `execFile("bash", ["-c", cmd])` |
| 配置 | 手写 `.env` 解析器(不引 dotenv) |

## 3. 文件结构

```
/workspace/
  plan.md
  package.json          # scripts: start / dev; devDeps
  tsconfig.json         # strict, NodeNext, erasableSyntaxOnly
  .env.example          # 配置模板(真实 .env 已被 .gitignore 排除)
  src/
    index.ts            # 入口: .env 加载 → REPL 或单次模式
    config.ts           # env 解析 + OpenRouter 配置
    types.ts            # 消息/工具/响应类型 (OpenAI 格式)
    bash.ts             # bash 工具: 执行 + 截断 + timeout
    agent.ts            # ReAct 循环
    system.ts           # system prompt 构建
```

预估总代码量 ~450 行。

## 4. 模块设计

### 4.1 `types.ts` — 类型定义

内部消息直接采用 OpenAI Chat Completions 格式,零转换:

```ts
export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string | null }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

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
```

### 4.2 `config.ts` — env 解析与 OpenRouter 配置

```ts
export interface Config {
  baseUrl: string;        // 固定 https://openrouter.ai/api/v1
  apiKey: string;         // OPENROUTER_API_KEY(必填,缺失则报错退出)
  model: string;          // MODEL,默认 deepseek/deepseek-chat
  reasoningEffort?: string; // REASONING_EFFORT: low/medium/high,默认不发送
  headers?: Record<string, string>; // HTTP-Referer(SITE_URL)/ X-Title(APP_NAME),可选
}
```

- 只支持 OpenRouter,无 provider 表、无选择逻辑
- `.env` 解析: 启动时读 `.env`(若存在),每行 `KEY=VALUE`,忽略空行/`#` 注释;`process.env` 已有值优先(不覆盖)

### 4.3 `bash.ts` — 唯一工具

参考 pi 的 bash 工具设计,关键决策:

```ts
export interface BashArgs { command: string; timeout?: number } // timeout 秒,可选

export async function bashTool(args: BashArgs): Promise<string>
```

- 执行:`execFile("bash", ["-c", command], { cwd, timeout })`,捕获 stdout+stderr
- **截断取 tail**(bash 场景错误/结果在末尾):
  - 阈值: 2000 行 / 50KB(`Buffer.byteLength` 计字节),谁先到算谁
  - 截断时完整输出写入 `os.tmpdir()` 临时文件,结果末尾追加:
    `[Showing lines X-Y of N. Full output: /tmp/xxx]` — 模型可用 bash 再读全文
- **退出码非 0 不抛错**,结果末尾追加 `Command exited with code N`(stderr 已包含在输出中)
- **timeout 触发** 返回错误文本(带已捕获的部分输出)
- 返回纯文本,成功且无输出时返回 `(no output)`
- `cwd`: 固定在启动目录(agent 工作目录)

### 4.4 `agent.ts` — ReAct 循环

```ts
export interface AgentOptions {
  config: Config;
  systemPrompt: string;
  maxIterations?: number;  // 默认 20
  temperature?: number;    // 默认 0
}

export class Agent {
  messages: ChatMessage[];           // 历史,REPL 多轮复用
  async chat(userText: string): Promise<string>;  // 一轮完整对话(含工具循环)
}
```

`chat()` 流程(标准 ReAct 工具调用模式):

```
1. push {role:user, content:userText}
2. loop (maxIterations):
   a. fetch POST {baseUrl}/chat/completions
      body: { model, messages, tools: [bashSchema], temperature, tool_choice:"auto" }
      headers: Authorization: Bearer {key}, Content-Type: application/json
   b. 非 2xx → 解析 body {error:{message}} 拼 HTTP status 抛出
   c. 取 choices[0].message
   d. push assistant 消息(含 tool_calls 时)
   e. 无 tool_calls → 返回 content(可能为 null → "")
   f. 有 tool_calls → 全部并行执行:
      - 解析 function.arguments(JSON.parse 失败 → 错误文本回填)
      - 调用对应工具,结果包装为 {role:"tool", tool_call_id, content}
      - 未知工具名 → 错误文本回填
   g. 超 maxIterations → 返回最后一条内容 + 警告
3. 成功返回最终答案
```

请求细节:
- 超时: fetch 侧 AbortController 60s;`bash` 工具自身有独立 timeout
- 响应流: 非流式(一次 JSON);后续如需流式,SSE 解析是独立函数,不动循环
- **reasoning 兼容**(OpenRouter 网关语义):
  - 请求侧: env `REASONING_EFFORT` 可选(low/medium/high),默认不发送;发送时 `{ reasoning: { effort } }`
  - 响应侧: `const reasoning = msg.reasoning ?? msg.reasoning_content`(后者是 OpenRouter 的别名)
  - reasoning 内容打印到 stderr(`[reasoning]` 前缀,截断),**不进 messages 历史**(省上下文)

### 4.5 `system.ts` — system prompt

参照 pi 结构,适配 bash-only:

```
You are a minimal coding agent operating in a bash-only environment.
You complete coding tasks by executing bash commands. All file reading,
searching, editing, and command execution are done through the bash tool.

Available tools:
- bash: Execute a bash command in the current working directory. Returns
  stdout and stderr. Output is truncated to last 2000 lines or 50KB.
  Optionally provide a timeout in seconds. Use for file operations like
  ls, rg, find, cat, sed, node -e.

Guidelines:
- Be concise in your responses
- Show file paths clearly when working with files
- Prefer bash for all file operations: reading (cat/tail/head), searching
  (rg/grep), editing (sed -i, node -e, tee), and command execution
- When bash output is truncated, the full output path is provided; read it
  with bash if you need more context
- Do not ask for confirmation before making changes; verify your work
  after changing files (e.g. re-read the changed section)

Current working directory: {cwd}
```

### 4.6 `index.ts` — 入口与 REPL

```
流程:
1. loadDotEnv()           # 读 .env
2. resolveConfig()        # key(MODEL,默认 deepseek/deepseek-chat)+ 校验
3. 构建 systemPrompt + Agent
4. 单次模式:  argv[2] 为 prompt → agent.chat(prompt) → 打印结果 → 退出
   交互模式:  readline/promises REPL:
     - 提示符 "> "
     - 输入 /exit | /quit → 退出;/reset → 清空 messages
     - 空输入忽略
     - 其他 → chat() → 打印最终答案
5. 打印时前置 "─── 最终答复 ───" 分隔,便于区分工具过程与答案
```

## 5. 开发步骤(按序)

| # | 步骤 | 验证 |
|---|---|---|
| 1 | `package.json` + `tsconfig.json` + `.env.example` | `npx tsc --noEmit` 通过 |
| 2 | `types.ts` + `config.ts`(.env 解析 + OpenRouter 配置) | 单测式冒烟: node 调 resolveConfig 打印 |
| 3 | `bash.ts`(执行/截断/临时文件/timeout/exit code) | 手动跑: 长输出截断、非 0 退出、timeout |
| 4 | `agent.ts`(fetch + 循环 + 并行 tool_calls) | 冒烟: 用真 key 跑 "echo hello" 任务 |
| 5 | `system.ts` + `index.ts`(REPL/单次) | 端到端: REPL 多轮追问 |
| 6 | 收尾: 校验 `.env.example`、整体走查 | `git status` 干净 |

## 6. 明确不做(保持极简)

- 不做 TUI(REPL + 纯文本输出足够;未来演进:流式打印 → 工具调用日志行)
- 不做会话持久化(历史仅内存;未来如需: jsonl 落盘,参考 pi session 设计)
- 不做内部消息抽象层(直接 OpenAI 格式,仅 OpenRouter,不支持 Anthropic/Gemini 原生协议)
- 不做 schema 自动生成(唯一工具,bash schema 手写)
- 不做技能(skills)/扩展系统/prompt 模板

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| OpenRouter reasoning 模型兼容 | 已设计: `reasoning: {effort}` 请求参数 + `reasoning`/`reasoning_content` 双字段解析(见 4.4);默认不发送 |
| 长上下文耗尽(REPL 多轮) | maxIterations 上限 + 提示用户 /reset;未来可加简单裁剪 |
| bash 命令长期挂起 | 工具级 timeout 可选参数,默认无限制由模型自控 |
| 工具输出撑爆上下文 | 50KB 截断 + 临时文件兜底(模型按需读取) |
