// 极简 Markdown 渲染(仅终端显示,零依赖):有状态的行渲染器。
// 只处理:标题、加粗、行内代码、围栏代码块;其余原样。
// 仅作用于 stdout 显示,存储与 API 消息不受影响。
// 流式输出按"完整行"渲染:攒到换行符才处理,ANSI 码不会被截断。
import { blue, bold, green, italicGray, useColor, yellow } from "./color.ts";

// 行内规则: **加粗** 或 `代码`(交替正则,互不嵌套)
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;
// 标题: #/##/### 开头(空标题跳过)
const HEADING = /^(#{1,3})\s+(.*)$/;
// 围栏: ``` 或 ```lang
const FENCE = /^```/;

function renderInline(line: string): string {
  return line.replace(INLINE, (m) =>
    m.startsWith("**") ? bold(m.slice(2, -2)) : yellow(m.slice(1, -1)),
  );
}

// 有状态: 跟踪围栏代码块,块内整行绿色且跳过行内渲染
// (防止代码里的 # 注释、** 等被误染成标题/加粗)
export class MarkdownRenderer {
  private buffer = "";
  private inFence = false;

  write(text: string): void {
    this.buffer += text;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      process.stdout.write(this.render(line) + "\n");
    }
  }

  // 流结束兜底: 输出未换行的残留(正常情况下 agent 已补末尾换行,缓冲为空)
  flush(): void {
    if (this.buffer.length > 0) {
      process.stdout.write(this.render(this.buffer));
      this.buffer = "";
    }
  }

  private render(line: string): string {
    if (!useColor) return line; // 非 TTY / NO_COLOR: 原样(含 #、** 标记)
    if (FENCE.test(line)) {
      this.inFence = !this.inFence;
      return italicGray(line); // 围栏行本身(含语言名),斜体灰
    }
    if (this.inFence) return green(line); // 块内整行绿色,不做行内渲染
    const h = line.match(HEADING);
    if (h) return blue(bold(renderInline(h[2]))); // 标题: 蓝加粗,去 #
    return renderInline(line);
  }
}
