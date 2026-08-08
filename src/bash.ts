import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BashArgs {
  command: string;
  timeout?: number; // 秒,可选
}

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;
// 必须足够大以容纳完整输出,否则 execFile 直接抛 maxBuffer exceeded
const MAX_BUFFER = 64 * 1024 * 1024;

// 从末尾保留字符直到字节预算(多字节安全)
function tailBytes(text: string, maxBytes: number): string {
  let out = "";
  let bytes = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    const b = Buffer.byteLength(ch);
    if (bytes + b > maxBytes) break;
    out = ch + out;
    bytes += b;
  }
  return out;
}

// 先按行截断(tail),再按字节截断(tail)
function truncate(text: string): { text: string; startLine: number; totalLines: number } {
  const lines = text.split("\n");
  const totalLines = text.endsWith("\n") ? lines.length - 1 : lines.length;
  let start = 0;
  if (totalLines > MAX_LINES) start = totalLines - MAX_LINES;
  let kept = lines.slice(start).join("\n");
  if (Buffer.byteLength(kept) > MAX_BYTES) kept = tailBytes(kept, MAX_BYTES);
  return { text: kept, startLine: start + 1, totalLines };
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

function runBash(command: string, timeoutMs?: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : undefined;
    execFile("bash", ["-c", command], { signal: ac.signal, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (timer) clearTimeout(timer);
      const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      const timedOut = !!e && (e.name === "AbortError" || e.code === "ABORT_ERR" || !!e.killed);
      const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
      resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code, timedOut });
    });
  });
}

export async function bashTool(args: BashArgs): Promise<string> {
  const timeoutMs = args.timeout && args.timeout > 0 ? args.timeout * 1000 : undefined;
  const { stdout, stderr, code, timedOut } = await runBash(args.command, timeoutMs);

  const combined = stdout + (stderr ? (stdout && !stdout.endsWith("\n") ? "\n" : "") + stderr : "");
  const { text, startLine, totalLines } = truncate(combined);

  const notes: string[] = [];
  if (text !== combined) {
    const path = join(tmpdir(), `simple-harness-${Date.now()}-${Math.random().toString(36).slice(2)}.out`);
    writeFileSync(path, combined);
    notes.push(`Showing lines ${startLine}-${totalLines} of ${totalLines}. Full output: ${path}`);
  }
  if (timedOut) notes.push(`Command timed out after ${args.timeout}s`);
  else if (code !== 0) notes.push(`Command exited with code ${code}`);

  let result = text;
  if (notes.length > 0) result += (result ? "\n" : "") + notes.map((n) => `[${n}]`).join(" ");
  return result || "(no output)";
}
