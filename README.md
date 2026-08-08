# simple-harness

一个极简的 TypeScript coding agent。设计理念:**只提供一个 bash 工具** —— 所有文件读取、搜索、编辑、命令执行都由模型通过 bash 完成。

## 特性

- 🛠️ 单一 `bash` 工具:文件操作 + 命令执行,零额外工具
- 🔌 兼容 OpenRouter(OpenAI Chat Completions 协议)
- ⚡ 流式输出,支持 reasoning(思考过程)显示
- 💬 两种模式:交互 REPL + 单次执行
- 📦 零运行时依赖:纯 Node 内置模块 + fetch
- ✂️ bash 输出自动截断(2000 行 / 50KB),完整输出保存到临时文件
- ⏱️ 命令支持可选 timeout,超时自动中止
- 🎨 终端着色:命令按成败染绿/红,失败与错误有醒目标签

## 环境要求

- Node.js >= 22
- pnpm

## 安装

```bash
pnpm install
```

## 配置

复制 `.env.example` 为 `.env` 并填写:

```bash
cp .env.example .env
```

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key |
| `MODEL` | | 模型 ID,默认 `deepseek/deepseek-v4-flash-0731` |
| `SITE_URL` | | 展示在 OpenRouter 排行榜上的站点(可选) |
| `APP_NAME` | | 展示在 OpenRouter 排行榜上的应用名(可选) |
| `MAX_ITERATIONS` | | agent 循环上限,默认 20 |
| `REASONING_EFFORT` | | 推理强度 `low` / `medium` / `high`(可选) |

## 使用

```bash
pnpm dev                        # 交互 REPL
pnpm dev "完成下面的任务: ..."  # 单次模式,执行后退出
```

### REPL 命令

| 命令 | 说明 |
|---|---|
| `/exit` 或 `/quit` | 退出 |
| `/clear` | 清空对话历史(保留 system) |

## 开发

```bash
pnpm typecheck   # TypeScript 类型检查
pnpm dev         # 运行
```

## 项目结构

```
.
├── src/
│   ├── index.ts    # 入口:加载 .env → REPL 或单次模式
│   ├── agent.ts    # ReAct 循环:流式请求 + 工具调用
│   ├── bash.ts     # bash 工具:执行 + 截断 + timeout
│   ├── config.ts   # .env 解析 + OpenRouter 配置
│   ├── types.ts    # OpenAI Chat Completions 格式类型
│   ├── system.ts   # system prompt 构建
│   └── color.ts    # 终端 ANSI 着色(零依赖)
├── .env.example    # 配置模板
└── package.json
```

## 工作原理

1. 每次请求以完整对话历史调用 OpenRouter 的 `/chat/completions`(stream)
2. 流式解析 SSE,实时输出 content 与 reasoning(思考过程)
3. 若模型返回 `tool_calls`,执行对应 bash 命令,把结果作为 `tool` 消息回传
4. 循环直至模型给出最终回答或达到 `MAX_ITERATIONS`
5. 对话历史保存在内存中,REPL 多轮可复用
