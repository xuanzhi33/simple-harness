// bash 命令只读判断(理念参照 temp/parser.ts,但只取"命令名粗判 + 少量特判"):
// 接受"部分只读命令漏报"(显示为普通色),但杜绝"有副作用命令误报只读"(变灰)。
// 因此名单只放绝对纯读命令;写能力命令(tee/env/xargs)、git 写子命令一律不入。
const READONLY_COMMANDS = new Set([
  "cat","ls","grep","head","tail","find","wc","pwd","date","which","echo","awk","sort","uniq",
  "diff","jq","tree","ps","df","free","id","whoami","stat","file","readlink","realpath","du",
  "seq","nl","tac","comm","column","fold","tr","less","more","pgrep","lsof","ss","read","test",
  "[","true","false","basename","dirname","hostname","uname","groups","type",
]);

// git 只读子命令(只留纯读;fetch/config/branch/tag/remote 等可写,不灰)
const GIT_READONLY_SUB = new Set([
  "status","log","diff","show","rev-parse","blame","describe","shortlog","reflog",
  "cat-file","show-ref","ls-files","ls-remote",
]);

export function isReadonly(command: string): boolean {
  // 丢弃到 /dev/null(2>/dev/null、>/dev/null、&>/dev/null)或 fd(2>&1)的重定向无副作用,先抹掉
  const stripped = command.replace(/\d*&?>+\s*\/dev\/null|\d*>&\d+/g, "");
  if (/>/.test(stripped)) return false; // 剩余的输出重定向 = 写(引号内 > 误伤可接受)
  if (/-i\b|--in-place/.test(command)) return false; // sed -i 原地写
  const [cmd, sub] = command.trim().split(/\s+/);
  if (cmd === "sed") return true; // 带 -i 的已在上面返回 false,到这里的 sed 无原地写
  if (cmd === "git") return GIT_READONLY_SUB.has(sub);
  return READONLY_COMMANDS.has(cmd);
}
