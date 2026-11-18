/**
 * A document's text for customer pages: headings, paragraphs, lists and **bold**, drawn as React elements
 * (never as HTML), so nothing in the text can run in the reader's browser. Prints cleanly.
 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function PlainDoc({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = markdown.replace(/\r/g, "").split("\n");
  let list: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={`p${blocks.length}`} className="leading-relaxed">
          <Inline text={paragraph.join(" ")} />
        </p>,
      );
      paragraph = [];
    }
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="ml-5 list-disc space-y-1">
          {list.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      const level = heading[1]!.length;
      blocks.push(
        level <= 1 ? (
          <h2 key={`h${blocks.length}`} className="pt-2 text-lg font-semibold text-foreground">
            {heading[2]}
          </h2>
        ) : (
          <h3 key={`h${blocks.length}`} className="pt-2 text-base font-semibold text-foreground">
            {heading[2]}
          </h3>
        ),
      );
    } else if (item) {
      if (paragraph.length) flush();
      list.push(item[1]!);
    } else {
      if (list.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <div className="flex flex-col gap-3 text-sm text-foreground/90">{blocks}</div>;
}
