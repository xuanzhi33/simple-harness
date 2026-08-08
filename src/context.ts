// 极简 AGENTS.md 支持: 读取 <cwd>/AGENTS.md 常驻注入 system prompt
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentsContext {
  path: string;
  content: string;
}

export function loadAgentsMd(cwd: string): AgentsContext | null {
  const filePath = join(cwd, "AGENTS.md");
  if (!existsSync(filePath)) return null;
  try {
    return { path: filePath, content: readFileSync(filePath, "utf8") };
  } catch {
    return null;
  }
}

export function formatAgentsMdPrompt(ctx: AgentsContext | null): string {
  if (!ctx) return "";
  return `\n\n# Project context (from ${ctx.path})\n${ctx.content}`;
}
