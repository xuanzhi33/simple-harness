// 极简 ANSI 颜色(零依赖);非 TTY 或 NO_COLOR 时输出原样
const useColor = !process.env.NO_COLOR && (process.stderr.isTTY || process.stdout.isTTY);

function wrap(open: string) {
  return (s: string) => (useColor ? `\x1b[${open}m${s}\x1b[0m` : s);
}

export const gray = wrap("90"); // 思考内容
export const green = wrap("32"); // bash 成功
export const red = wrap("31"); // bash 失败 / 错误

// 标签: 背景色 + 黑/白字,用法: tagSkyBlue(" REASONING ")
export const tagSkyBlue = wrap("104;30");
export const tagCyan = wrap("46;30");
export const tagRed = wrap("41;37");
