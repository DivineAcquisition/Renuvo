/**
 * A real PDF, written by hand: Helvetica text on US Letter pages with headings, wrapping and page
 * numbers. It is made from the exact text of one saved version, so the file a person downloads is the
 * document that was approved or sent. It is deliberately plain: no fonts are embedded, so characters
 * outside Latin-1 are replaced with close equivalents or "?". Other export formats are not offered.
 */
const PAGE = { width: 612, height: 792, margin: 72 };
const SIZES = { h1: 18, h2: 13, body: 11, foot: 9 };

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
];

function latin1(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Average Helvetica glyph width is about half the size; close enough for wrapping plain text. */
function wrap(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(10, Math.floor(width / (size * 0.5)));
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if ((line ? line.length + 1 : 0) + word.length <= maxChars) line = line ? `${line} ${word}` : word;
      else {
        if (line) out.push(line);
        let rest = word;
        while (rest.length > maxChars) {
          out.push(rest.slice(0, maxChars));
          rest = rest.slice(maxChars);
        }
        line = rest;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

type Line = { text: string; size: number; bold: boolean; gap: number };

function layout(markdown: string): Line[] {
  const lines: Line[] = [];
  const width = PAGE.width - PAGE.margin * 2;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const h1 = /^#\s+(.*)$/.exec(raw);
    const h2 = /^##\s+(.*)$/.exec(raw);
    const text = latin1((h1 ?? h2)?.[1] ?? raw.replace(/\*\*(.*?)\*\*/g, "$1"));
    const size = h1 ? SIZES.h1 : h2 ? SIZES.h2 : SIZES.body;
    const bold = Boolean(h1 || h2);
    const wrapped = wrap(text, size, width);
    if (wrapped.length === 0) wrapped.push("");
    wrapped.forEach((part, index) => lines.push({ text: part, size, bold, gap: index === 0 && h2 ? 8 : 0 }));
  }
  return lines;
}

export type PdfOptions = { title: string; footer?: string };

export function markdownToPdf(markdown: string, options: PdfOptions): Uint8Array {
  const lines = layout(markdown);
  const pages: Line[][] = [[]];
  let y = PAGE.height - PAGE.margin;
  for (const line of lines) {
    const height = line.size * 1.45 + line.gap;
    if (y - height < PAGE.margin) {
      pages.push([]);
      y = PAGE.height - PAGE.margin;
    }
    pages[pages.length - 1].push(line);
    y -= height;
  }

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const tree = add("");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  pages.forEach((page, index) => {
    let cursor = PAGE.height - PAGE.margin;
    const ops: string[] = [];
    for (const line of page) {
      cursor -= line.size * 1.45 + line.gap;
      if (line.text) ops.push(`BT /${line.bold ? "F2" : "F1"} ${line.size} Tf ${PAGE.margin} ${cursor.toFixed(2)} Td (${escape(line.text)}) Tj ET`);
    }
    const foot = latin1(`${options.footer ? `${options.footer}  |  ` : ""}Page ${index + 1} of ${pages.length}`);
    ops.push(`BT /F1 ${SIZES.foot} Tf ${PAGE.margin} ${PAGE.margin / 2} Td (${escape(foot)}) Tj ET`);
    const stream = ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  const info = add(`<< /Title (${escape(latin1(options.title))}) /Producer (Selestial) >>`);
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character was reduced to Latin-1 above, so one byte per character is exact.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
