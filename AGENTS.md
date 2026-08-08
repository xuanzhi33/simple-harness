# AGENTS.md

simple-harness:极简 TypeScript coding agent(单 bash 工具,OpenRouter,零 npm 运行时依赖)。

## 开发命令

- `pnpm dev` — 运行(REPL / 单次模式)
- `pnpm typecheck` — 类型检查(修改只需通过它,无需运行测试)

## 规则

- 修改后只需 `pnpm typecheck` 通过;不写/不跑自动化测试
- 始终保持极简:不引入 npm 依赖,不添加多余抽象,新增代码优先复用现有模块
- 改动用户可见行为(输出、配置、文档)时,同步更新 README.md
- 配置只保留 `OPENROUTER_API_KEY` 与 `MODEL`(.env),其他一律写死
