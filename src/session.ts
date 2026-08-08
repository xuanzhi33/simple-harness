// 极简会话持久化: <cwd>/session.jsonl,一行一条 ChatMessage(不含 system)
// 每次消息更新后整体覆盖写(文件小);加载时跳过 system 与坏行,容错半写/损坏
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { ChatMessage } from "./types.ts";

export function loadSession(path: string): ChatMessage[] {
  if (!existsSync(path)) return [];
  const out: ChatMessage[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed) as ChatMessage;
      if (msg.role === "system") continue; // system 每次启动重建,不持久化
      out.push(msg);
    } catch {
      // 坏行(上次写入中断等):跳过,不损坏其余历史
    }
  }
  return out;
}

export function saveSession(path: string, messages: ChatMessage[]): void {
  const lines = messages
    .filter((m) => m.role !== "system")
    .map((m) => JSON.stringify(m));
  writeFileSync(path, lines.length > 0 ? lines.join("\n") + "\n" : "");
}

export function clearSession(path: string): void {
  rmSync(path, { force: true });
}
