#!/usr/bin/env tsx
/**
 * exa.ts — thin CLI wrapper around mcporter for Exa's MCP server.
 *
 * Usage (tsx must be on PATH — globally installed):
 *   ./exa.ts search <query> [numResults] [--json]
 *   ./exa.ts fetch  <url> [url2 ...] [--json]
 * If tsx isn't global: pnpm exec tsx exa.ts search ...
 *
 * Wraps (no API key needed):
 *   mcporter call https://mcp.exa.ai/mcp.web_search_exa query="..." numResults=N --output json
 *   mcporter call https://mcp.exa.ai/mcp.web_fetch_exa  urls="a,b,c"             --output json
 */

import { spawn } from "node:child_process";

const EXA_BASE = "https://mcp.exa.ai";
const DEFAULT_NUM_RESULTS = 10;

const USAGE = `Usage:
  ./exa.ts search <query> [numResults] [--json]
  ./exa.ts fetch <url> [url2 ...] [--json]
(tsx not on PATH? run: pnpm exec tsx exa.ts ...)`;

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

/** Run one mcporter call; resolves with the raw JSON text from stdout. */
function runMcp(tool: string, args: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const flagArgs = Object.entries(args).map(([k, v]) => `${k}=${v}`);
    const child = spawn("mcporter", ["call", `${EXA_BASE}/${tool}`, "--output", "json", ...flagArgs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") reject(new Error("mcporter not found — install it with: npm install -g mcporter"));
      else reject(e);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`mcporter exited with code ${code}: ${err.trim()}`));
    });
  });
}

/** Extract the markdown text blocks from mcporter's JSON response. */
function textBlocks(json: string): string {
  const parsed: { content?: { type: string; text?: string }[] } = JSON.parse(json);
  const blocks = (parsed.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!.trim());
  return blocks.join("\n\n---\n\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jsonFlag = argv.includes("--json");
  const positional = argv.filter((a) => a !== "--json");

  if (positional.length === 0 || positional[0] === "--help" || positional[0] === "-h") usage();

  const [cmd, ...rest] = positional;

  if (cmd === "search") {
    const [query, numResultsArg] = rest;
    if (!query) usage();
    const numResults = numResultsArg !== undefined ? Number(numResultsArg) : DEFAULT_NUM_RESULTS;
    if (!Number.isInteger(numResults) || numResults < 1) usage();
    const raw = await runMcp("mcp.web_search_exa", { query, numResults: String(numResults) });
    console.log(jsonFlag ? raw : textBlocks(raw));
  } else if (cmd === "fetch") {
    const urls = rest; // keep all positionals
    if (urls.length === 0) usage();
    if (urls.length === 1) {
      // Single URL: plain passthrough (same shape as mcporter --output json).
      const raw = await runMcp("mcp.web_fetch_exa", { urls: urls[0] });
      console.log(jsonFlag ? raw : textBlocks(raw));
    } else {
      // Exa's server rejects comma-joined URLs, so fetch each URL separately.
      const results: Record<string, string> = {};
      for (const u of urls) results[u] = await runMcp("mcp.web_fetch_exa", { urls: u });
      if (jsonFlag) {
        const parsed: Record<string, unknown> = {};
        for (const u of urls) parsed[u] = JSON.parse(results[u]);
        console.log(JSON.stringify(parsed, null, 2));
      } else {
        console.log(urls.map((u) => `## ${u}\n\n${textBlocks(results[u])}`).join("\n\n"));
      }
    }
  } else {
    usage();
  }
}

main().catch((e: Error) => {
  console.error(`exa.ts: ${e.message}`);
  process.exit(1);
});
