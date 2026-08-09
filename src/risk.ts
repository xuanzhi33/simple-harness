// bash 命令高风险判断(理念:尽量提示风险,不做精细只读判定):
// git 写子命令 / 包管理器安装移除 / 网络请求 / python·node 代码内执行命令 → 标黄提示。
// 普通文件操作(rm/mv/echo > file 等)不标黄。
const GIT_WRITE_SUB = new Set([
  "add","commit","push","pull","merge","rebase","reset","checkout","switch","restore",
  "clean","stash","clone","init","branch","tag","fetch","cherry-pick","revert","mv","rm","config",
]);
const PKG_MANAGERS = new Set(["npm","pnpm","yarn","bun"]);
const PKG_WRITE_SUB = new Set(["install","i","add","remove","rm","uninstall","un","update","up","ci","link","dedupe"]);
const NET_COMMANDS = new Set(["curl","wget","ssh","scp","sftp","rsync"]);
// python subprocess / node child_process 等代码内执行命令
const INLINE_EXEC = /subprocess|child_process|os\.system|spawn|execSync/;

function isRiskySingle(cmd: string): boolean {
  if (INLINE_EXEC.test(cmd)) return true;
  const [name, sub] = cmd.trim().split(/\s+/);
  if (name === "git") return GIT_WRITE_SUB.has(sub);
  if (PKG_MANAGERS.has(name)) return PKG_WRITE_SUB.has(sub);
  return NET_COMMANDS.has(name);
}

// 复合命令按连接符拆开,任一子命令高风险则整条标黄
export function isRisky(command: string): boolean {
  return command.split(/\s*(?:&&|\|\||;|\|)\s*/).some(isRiskySingle);
}
