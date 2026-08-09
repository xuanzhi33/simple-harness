# simple-harness

极简 TypeScript coding agent —— 只提供一个 `bash` 工具,所有文件读取、搜索、编辑、执行都由模型通过 bash 完成。零运行时依赖。

## 特性

- 单一 `bash` 工具,OpenRouter 接入(流式 + 思考过程显示)
- 双模式:交互 REPL / 单次执行
- bash 输出自动截断(2000 行 / 50KB)至临时文件,支持 timeout
- 终端着色:命令成败绿/红,思考灰字,🤔 / 💻 标签
- Skills 支持:自动加载 `.agents/skills` 注入 system prompt
- AGENTS.md 支持:项目根指令文件常驻注入
- 会话持久化:历史实时写入 `session.jsonl`,重启自动恢复
- 启动时显示模型名称、加载的 skills 数量与 AGENTS.md 状态
- 每轮 API 调用后显示 usage:输入/输出 token、缓存命中率与费用(如有)
- 手动上下文压缩:`/compact` 将历史总结为结构化摘要,释放上下文窗口

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
| `/clear` | 清空对话历史(保留 system)并删除 `session.jsonl` |
| `/compact` | 手动压缩上下文:将历史总结为结构化摘要,替换全部旧对话 |

`/compact` 参考 [pi](https://github.com/earendil-dev/pi) 的 compaction 方案:调用模型(非流式、不带工具)生成 `Goal / Constraints / Progress / Key Decisions / User Messages / Next Steps / Critical Context` 结构化的上下文检查点(借鉴 Claude Code:逐条列出所有用户消息、下一步引用最近对话原文),替换全部旧对话(旧记录同步从 `session.jsonl` 移除)。压缩后立即持久化,重启后仍生效:

```
✅ compacted: ~12.3k → ~0.4k tokens
```

## Skills

在项目根目录 `.agents/skills/` 下放置技能,启动时自动加载并注入 system prompt:

```
.agents/skills/
├── git-pr/
│   └── SKILL.md        # 目录形式:frontmatter 声明 name / description
└── notes.md            # 散 .md 也可(仅根目录)
```

`SKILL.md` 格式(遵循 Agent Skills 规范子集):

```markdown
---
name: git-pr
description: Create a pull request with git, including branch, commit, and push steps.
---

# Creating a pull request
1. Create a branch: ...
```

规则:目录含 `SKILL.md` 即技能根(不再递归);`description` 必填(缺失则忽略);`name` 缺省用目录名。加载后模型按需用 `cat` 读取技能文件执行。

## 会话持久化

历史对话实时保存到当前工作目录的 `session.jsonl`(每行一条消息,不含 system),下次启动自动恢复:

- 每次消息更新(用户输入 / 助手回复 / 工具结果)后立即覆盖写,重启不丢上下文
- `system` 不持久化:每次启动根据 skills / AGENTS.md 动态重建
- `/clear` 会同时清空内存历史与 `session.jsonl`
- 加载时跳过损坏行,半写/崩溃最多丢最后一条,不影响已有历史

启动时终端依次显示模型名称、skills / AGENTS.md 状态与恢复状态:

```
🤖 deepseek/deepseek-v4-flash-0731   # 来自 .env 的 MODEL,缺省用默认值
📦 2 loaded
💾 3 messages restored               # 或 session: empty
```

## Token 用量

OpenRouter 流式响应在 `[DONE]` 前返回 usage chunk,每次 API 调用结束后终端显示一行用量统计(缺失字段自动省略):

```
📊 ↑ 1523 · ↓ 456 · cache 40% · $0.00015
```

- `↑` 输入 token;`↓` 输出 token
- `cache %`:提示缓存命中率(`prompt_tokens_details.cached_tokens`)
- `$` 费用:OpenRouter 的 `usage.cost`,接口未返回则不显示

## AGENTS.md

项目根目录的 `AGENTS.md` 作为**项目级指令**常驻注入 system prompt(每轮对话生效,约束所有行为),区别于按需读取的 skills:

```
AGENTS.md   # 项目约定:构建命令、代码风格、注意事项
```

本项目根目录自带一份用于开发的 `AGENTS.md`(构建/极简/文档规则)。

启动时终端会显示加载状态:

```
📦 2 loaded
📄 /path/to/AGENTS.md                    # 未找到时不显示
```

## 工作原理

1. 以完整历史调用 OpenRouter `/chat/completions`(stream)
2. SSE 流式解析,实时输出思考(🤔)与回答
3. 模型返回 `tool_calls` 时执行 bash(💻),结果回传为 `tool` 消息
4. 循环至最终回答或达到上限(20 轮);历史存内存,REPL 多轮复用

## 项目结构

```
src/
├── agent.ts    # ReAct 循环:流式请求 + 工具调用
├── index.ts    # 入口:加载 .env → REPL 或单次模式
├── bash.ts     # bash 工具:执行 + 截断 + timeout
├── skills.ts   # .agents/skills 扫描 + frontmatter + 注入
├── context.ts  # AGENTS.md 加载 + 注入
├── config.ts   # .env 解析 + OpenRouter 配置
├── types.ts    # OpenAI Chat Completions 格式类型
├── system.ts   # system prompt 构建
└── color.ts    # 终端 ANSI 着色(零依赖)
```

共约 670 行 TypeScript。
