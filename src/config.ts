import { readFileSync } from "node:fs";

export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  headers: Record<string, string>;
  maxIterations: number;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
const DEFAULT_MAX_ITERATIONS = 20;

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

  const headers: Record<string, string> = {};
  if (process.env.SITE_URL) headers["HTTP-Referer"] = process.env.SITE_URL;
  if (process.env.APP_NAME) headers["X-Title"] = process.env.APP_NAME;

  const effort = process.env.REASONING_EFFORT;
  const reasoningEffort =
    effort === "low" || effort === "medium" || effort === "high" ? effort : undefined;

  const rawIter = Number(process.env.MAX_ITERATIONS ?? DEFAULT_MAX_ITERATIONS);
  const maxIterations =
    Number.isFinite(rawIter) && rawIter > 0 ? Math.floor(rawIter) : DEFAULT_MAX_ITERATIONS;

  return {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey,
    model: process.env.MODEL ?? DEFAULT_MODEL,
    reasoningEffort,
    headers,
    maxIterations,
  };
}
