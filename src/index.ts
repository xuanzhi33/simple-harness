import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadDotEnv, resolveConfig } from "./config.ts";
import { bashTool, type BashArgs } from "./bash.ts";
import { Agent } from "./agent.ts";
import { buildSystemPrompt } from "./system.ts";
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
  const agent = new Agent({ config, systemPrompt: buildSystemPrompt(process.cwd()) }, [bashToolDef]);

  // 单次模式: 传入 prompt 则跑完退出
  const promptArg = process.argv[2];
  if (promptArg) {
    console.log(await agent.chat(promptArg));
    return;
  }

  // 交互 REPL
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("simple-harness — /exit quit, /reset clear history");
  for (;;) {
    let input: string;
    try {
      input = (await rl.question("> ")).trim();
    } catch {
      break; // Ctrl+C
    }
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (input === "/reset") {
      agent.messages.length = 1; // 保留 system
      console.log("[history cleared]");
      continue;
    }
    console.log("\n─── 最终答复 ───");
    try {
      console.log(await agent.chat(input));
    } catch (e) {
      console.error(`[error] ${(e as Error).message}`);
    }
    console.log("─────────────────");
  }
  rl.close();
}

main().catch((e: unknown) => {
  console.error(`[error] ${(e as Error).message}`);
  process.exit(1);
});
