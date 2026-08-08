# simple-harness

极简 TypeScript coding agent —— 只提供一个 `bash` 工具,所有文件读取、搜索、编辑、执行都由模型通过 bash 完成。零运行时依赖。

## 特性

- 单一 `bash` 工具,OpenRouter 接入(流式 + 思考过程显示)
- 双模式:交互 REPL / 单次执行
- bash 输出自动截断(2000 行 / 50KB)至临时文件,支持 timeout
- 终端着色:命令成败绿/红,思考灰字,🤔 / 💻 标签

## 环境要求

Node.js >= 22,pnpm

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入 OPENROUTER_API_KEY
pnpm dev               # 交互 REPL
pnpm dev "任务描述"    # 单次执行
```

配置只需两个变量:

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key |
| `MODEL` | | 模型 ID,默认 `deepseek/deepseek-v4-flash-0731` |

### REPL 命令

| 命令 | 说明 |
|---|---|
| `/exit` `/quit` | 退出 |
| `/clear` | 清空对话历史(保留 system) |

## 工作原理

1. 以完整历史调用 OpenRouter `/chat/completions`(stream)
2. SSE 流式解析,实时输出思考(🤔)与回答
3. 模型返回 `tool_calls` 时执行 bash(💻),结果回传为 `tool` 消息
4. 循环至最终回答或达到上限(20 轮);历史存内存,REPL 多轮复用

## 项目结构(src 共 535 行)

```
├── agent.ts    # ReAct 循环:流式请求 + 工具调用 (243)
├── index.ts    # 入口:加载 .env → REPL 或单次模式 (81)
├── bash.ts     # bash 工具:执行 + 截断 + timeout (82)
├── config.ts   # .env 解析 + OpenRouter 配置 (41)
├── types.ts    # OpenAI Chat Completions 格式类型 (41)
├── system.ts   # system prompt 构建 (28)
└── color.ts    # 终端 ANSI 着色(零依赖) (19)
```
