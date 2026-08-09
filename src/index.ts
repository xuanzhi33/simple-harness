import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { join } from "node:path";
import { loadDotEnv, resolveConfig } from "./config.ts";
import { bashTool, type BashArgs } from "./bash.ts";
import { Agent } from "./agent.ts";
import { buildSystemPrompt } from "./system.ts";
import { formatSkillsForPrompt, loadSkills } from "./skills.ts";
import { formatAgentsMdPrompt, loadAgentsMd } from "./context.ts";
import { clearSession, loadSession, saveSession } from "./session.ts";
import { gray, green, red, tagRed, tagSkyBlue } from "./color.ts";
import { MarkdownRenderer } from "./markdown.ts";
import { isReadonly } from "./readonly.ts";
import type { Tool } from "./types.ts";

const bashToolDef: Tool = {
  name: "bash",
  description:
    "Execute a bash command in the current working directory. Returns stdout and stderr. " +
    "Output is truncated to last 2000 lines or 50KB, and the full output path is provided when truncated. " +
    "Optionally provide a timeout in seconds.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The bash command to execute" },
      timeout: { type: "number", description: "Optional timeout in seconds" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const { command } = args as unknown as BashArgs;
    if (!isReadonly(command)) {
      // 审批: 按 Enter 继续,Ctrl-C 中断(不保留 y/n 逻辑)
      console.error(`${tagSkyBlue(" \u{1F6E1} ")} ${gray("non-readonly \u2014 press Enter to run, Ctrl-C to abort")}`);
      const rl = createInterface({ input: stdin, output: stdout });
      await rl.question("");
      rl.close();
    }
    return bashTool(args as unknown as BashArgs);
  },
};

async function main(): Promise<void> {
  loadDotEnv();
  const config = resolveConfig();
  const cwd = process.cwd();
  console.log(`${tagSkyBlue(" \u{1F916} ")} ${green(config.model)}`);

  // 加载 skills 与 AGENTS.md,拼入 system prompt
  const skills = loadSkills(join(cwd, ".agents", "skills"));
  const agentsCtx = loadAgentsMd(cwd);
  console.log(`${tagSkyBlue(" 📦 ")} ${skills.length > 0 ? green(`${skills.length} loaded`) : red("0 loaded")}`);
  if (agentsCtx) console.log(`${tagSkyBlue(" 📄 ")} ${gray(agentsCtx.path)}`);
  const systemPrompt =
    buildSystemPrompt(cwd, config.model) + formatSkillsForPrompt(skills) + formatAgentsMdPrompt(agentsCtx);

  // 会话持久化: <cwd>/session.jsonl,每次消息更新后保存,启动时重新加载
  const sessionPath = join(cwd, "session.jsonl");
  // 行缓冲 Markdown 渲染: 流式 chunk 攒成完整行才着色,chat 结束后 flush
  const markdown = new MarkdownRenderer();
  const agent = new Agent(
    {
      config,
      systemPrompt,
      // reasoning 灰色直出(前缀/换行由 agent 处理);content 走 markdown 渲染
      onStream: (type, text) => {
        if (type === "content") markdown.write(text);
        else process.stdout.write(text);
      },
      onPersist: (messages) => saveSession(sessionPath, messages),
    },
    [bashToolDef],
  );
  const history = loadSession(sessionPath);
  if (history.length > 0) {
    for (const m of history) agent.messages.push(m); // 恢复历史(system 不持久化,无需重复)
    console.log(`${tagSkyBlue(" \u{1F4BE} ")} ${green(`${history.length} messages`)} ${gray("restored")}`);
  } else {
    console.log(`${tagSkyBlue(" \u{1F4BE} ")} ${gray("session: empty")}`);
  }

  // 单次模式: 传入 prompt 则跑完退出
  const promptArg = process.argv[2];
  if (promptArg) {
    try {
      await agent.chat(promptArg);
    } finally {
      markdown.flush(); // 流结束,输出最后一行残留
    }
    return;
  }

  // 交互 REPL
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`${green("simple-harness")} — /exit quit, /clear clear history, /compact summarize history`);
  for (;;) {
    let input: string;
    try {
      input = (await rl.question("> ")).trim();
    } catch {
      break; // Ctrl+C
    }
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (input === "/clear") {
      agent.messages.length = 1; // 保留 system
      clearSession(sessionPath); // 同步清空持久化,防止下次启动旧历史复活
      console.log(gray("[history cleared]"));
      continue;
    }
    if (input === "/compact") {
      try {
        await agent.compact();
      } catch (e) {
        console.error(`${tagRed(" ERROR ")} ${(e as Error).message}`);
      }
      continue;
    }
    try {
      await agent.chat(input);
    } catch (e) {
      console.error(`${tagRed(" ERROR ")} ${(e as Error).message}`);
    } finally {
      markdown.flush(); // 流结束,输出最后一行残留
    }
  }
  rl.close();
}

main().catch((e: unknown) => {
  console.error(`${tagRed(" ERROR ")} ${(e as Error).message}`);
  process.exit(1);
});
