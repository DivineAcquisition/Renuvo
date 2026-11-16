/**
 * The Markdown chat answers and drafts are written in, parsed into plain data that React renders as
 * elements. No HTML from the text ever reaches the page, and only http(s), mailto and in-app links are
 * kept. It tolerates half-written input, because answers are shown while they stream.
 *
 * Supported: headings, paragraphs, bullet, numbered and checkbox lists, tables, fenced code, quotes,
 * rules, **bold**, *italic*, `code`, [links](https://…), and [[TO CONFIRM: …]] markers.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "confirm"; text: string }
  | { kind: "br" };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: { checked: boolean | null; children: Inline[] }[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; children: Inline[] }
  | { kind: "table"; header: Inline[][]; align: ("left" | "right" | "center" | null)[]; rows: Inline[][][] }
  | { kind: "rule" };

export function safeHref(href: string): string | null {
  const value = href.trim();
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^\/app(\/|$|\?)/.test(value)) return value;
  return null;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const push = (node: Inline) => {
    if (text) out.push({ kind: "text", text });
    text = "";
    out.push(node);
  };
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const confirm = /^\[\[TO CONFIRM:\s*([^\]]+?)\s*\]\]/.exec(rest);
    if (confirm) {
      push({ kind: "confirm", text: confirm[1] });
      index += confirm[0].length;
      continue;
    }
    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 1) {
        push({ kind: "code", text: rest.slice(1, end) });
        index += end + 1;
        continue;
      }
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      push({ kind: "strong", children: parseInline(strong[2]) });
      index += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?=\S)([^*_]*?\S)\1(?![*_\w])/.exec(rest);
    if (em && (em[1] === "*" || !/\w/.test(source[index - 1] ?? ""))) {
      push({ kind: "em", children: parseInline(em[2]) });
      index += em[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]);
      if (href) push({ kind: "link", href, children: parseInline(link[1]) });
      else text += link[1];
      index += link[0].length;
      continue;
    }
    const bare = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest);
    if (bare && !/\w/.test(source[index - 1] ?? "")) {
      push({ kind: "link", href: bare[0], children: [{ kind: "text", text: bare[0] }] });
      index += bare[0].length;
      continue;
    }
    if (rest.startsWith("  \n") || rest.startsWith("\\\n")) {
      push({ kind: "br" });
      index += rest.startsWith("  \n") ? 3 : 2;
      continue;
    }
    text += source[index];
    index += 1;
  }
  if (text) out.push({ kind: "text", text });
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index++]);
      index += 1;
      blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && DIVIDER.test(lines[index + 1]) && lines[index + 1].includes("-")) {
      flush();
      const header = cells(line);
      const align = cells(lines[index + 1]).map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null));
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = cells(lines[index]);
        rows.push(header.map((_, column) => parseInline(row[column] ?? "")));
        index += 1;
      }
      blocks.push({ kind: "table", header: header.map(parseInline), align, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) body.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", children: parseInline(body.join("\n")) });
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]);
      const start = ordered ? Number.parseInt(item[2], 10) : 1;
      const items: { checked: boolean | null; children: Inline[] }[] = [];
      while (index < lines.length) {
        const match = LIST.exec(lines[index]);
        if (match && /\d/.test(match[2]) === ordered) {
          let body = match[3];
          let checked: boolean | null = null;
          const box = /^\[( |x|X)\]\s+(.*)$/.exec(body);
          if (box) {
            checked = box[1] !== " ";
            body = box[2];
          }
          // A nested item is kept as an indented line of its parent, which keeps half-written lists readable.
          const nested = match[1].length >= 2 && items.length > 0;
          if (nested) {
            const parent = items[items.length - 1];
            parent.children = [...parent.children, { kind: "br" }, { kind: "text", text: "• " }, ...parseInline(body)];
          } else items.push({ checked, children: parseInline(body) });
          index += 1;
        } else if (lines[index].trim() && /^\s{2,}\S/.test(lines[index]) && items.length) {
          const parent = items[items.length - 1];
          parent.children = [...parent.children, { kind: "br" }, ...parseInline(lines[index].trim())];
          index += 1;
        } else break;
      }
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flush();
  return blocks;
}

/** Plain text of a document, for a .txt download. */
export function plainText(source: string): string {
  return source
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*```.*$/gm, "");
}
