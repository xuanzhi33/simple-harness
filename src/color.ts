// 极简 ANSI 颜色(零依赖);非 TTY 或 NO_COLOR 时输出原样
const useColor = !process.env.NO_COLOR && (process.stderr.isTTY || process.stdout.isTTY);

function wrap(open: string) {
  return (s: string) => (useColor ? `\x1b[${open}m${s}\x1b[0m` : s);
}

export const dim = wrap("2");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const cyan = wrap("36");
