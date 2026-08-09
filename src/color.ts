// 极简 ANSI 颜色(零依赖);非 TTY 或 NO_COLOR 时输出原样
export const useColor = !process.env.NO_COLOR && (process.stderr.isTTY || process.stdout.isTTY);

function wrap(open: string) {
  return (s: string) => (useColor ? `\x1b[${open}m${s}\x1b[0m` : s);
}

export const gray = wrap("90"); // 思考内容
export const green = wrap("32"); // bash 成功 / 代码块
export const red = wrap("31"); // bash 失败 / 错误
export const yellow = wrap("33"); // 行内代码
export const blue = wrap("34"); // 标题
export const bold = wrap("1"); // 加粗

// 标签: 背景色 + 黑/白字,用法: tagSkyBlue(" REASONING ")
export const tagSkyBlue = wrap("104;30");
export const tagGreen = wrap("42;30"); // bash 成功
// bash 失败 / 错误
const tagRed = wrap("41;37");
export { tagRed };

export const italicGray = wrap("3;90"); // 斜体 + 灰,如 "…(18 lines)"、围栏行
