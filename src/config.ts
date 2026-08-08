import { readFileSync } from "node:fs";

export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

// 启动时读 .env(若存在): KEY=VALUE,忽略空行/`#` 注释;process.env 已有值优先(不覆盖)
export function loadDotEnv(): void {
  try {
    const text = readFileSync(".env", "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env 不存在,忽略
  }
}

export function resolveConfig(): Config {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set (see .env.example)");

  return {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey,
    model: process.env.MODEL ?? DEFAULT_MODEL,
    headers: { "X-Title": "simple-harness" },
  };
}
