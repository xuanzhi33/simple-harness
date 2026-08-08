import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { join } from "node:path";
import { loadDotEnv, resolveConfig } from "./config.ts";
import { bashTool, type BashArgs } from "./bash.ts";
import { Agent } from "./agent.ts";
import { buildSystemPrompt } from "./system.ts";
import { formatSkillsForPrompt, loadSkills } from "./skills.ts";
import { formatAgentsMdPrompt, loadAgentsMd } from "./context.ts";
import { gray, green, red, tagRed, tagSkyBlue } from "./color.ts";
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
  execute: (args) => bashTool(args as unknown as BashArgs),
};

async function main(): Promise<void> {
  loadDotEnv();
  const config = resolveConfig();
  const cwd = process.cwd();

  // 加载 skills 与 AGENTS.md,拼入 system prompt
  const skills = loadSkills(join(cwd, ".agents", "skills"));
  const agentsCtx = loadAgentsMd(cwd);
  console.log(`${tagSkyBlue(" 📦 ")} ${skills.length > 0 ? green(`${skills.length} loaded`) : red("0 loaded")}`);
  if (agentsCtx) console.log(`${tagSkyBlue(" 📄 ")} ${gray(agentsCtx.path)}`);
  const systemPrompt =
    buildSystemPrompt(cwd, config.model) + formatSkillsForPrompt(skills) + formatAgentsMdPrompt(agentsCtx);

  const agent = new Agent(
    {
      config,
      systemPrompt,
      // reasoning 文本自带 "\n[reasoning] " 前缀与结尾换行,content 直接输出
      onStream: (_type, text) => process.stdout.write(text),
    },
    [bashToolDef],
  );

  // 单次模式: 传入 prompt 则跑完退出
  const promptArg = process.argv[2];
  if (promptArg) {
    await agent.chat(promptArg);
    return;
  }

  // 交互 REPL
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`${green("simple-harness")} — /exit quit, /clear clear history`);
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
      console.log(gray("[history cleared]"));
      continue;
    }
    try {
      await agent.chat(input);
    } catch (e) {
      console.error(`${tagRed(" ERROR ")} ${(e as Error).message}`);
    }
  }
  rl.close();
}

main().catch((e: unknown) => {
  console.error(`${tagRed(" ERROR ")} ${(e as Error).message}`);
  process.exit(1);
});
