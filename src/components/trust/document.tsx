import Link from "next/link";

import type { Block, DocumentText } from "@/lib/trust/documents/types";
import { formatDay } from "@/lib/trust/public";
import { cn } from "@/lib/utils";

import type { DocumentVersion } from "../../../convex/lib/trust/documents";

/** Turns [label](/path) and [label](mailto:x) into links. Nothing else in the text becomes markup. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(((?:\/[a-z0-9/#-]*)|(?:mailto:[^)\s]+))\)/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parts.push(text.slice(last, match.index));
    const [, label, href] = match;
    parts.push(
      href.startsWith("mailto:") ? (
        <a key={match.index} href={href} className="font-medium text-[#5126c7] underline underline-offset-4">
          {label}
        </a>
      ) : (
        <Link key={match.index} href={href} className="font-medium text-[#5126c7] underline underline-offset-4">
          {label}
        </Link>
      ),
    );
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function BlockView({ block }: { block: Block }) {
  if ("p" in block) return <p className="leading-relaxed text-[#3d3654]"><Inline text={block.p} /></p>;
  if ("note" in block)
    return (
      <p className="rounded-xl border border-[#d9cfff] bg-[#eee8ff] px-4 py-3 text-sm leading-relaxed text-[#3f1d9e]">
        <Inline text={block.note} />
      </p>
    );
  if ("list" in block)
    return (
      <ul className="grid list-disc gap-1.5 pl-5 leading-relaxed text-[#3d3654] marker:text-[#6838ef]">
        {block.list.map((item) => (
          <li key={item}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e4e7ef]">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-[#f8f9fc] text-[#211a35]">
          <tr>
            {block.table.head.map((cell) => (
              <th key={cell} scope="col" className="px-3.5 py-2.5 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, index) => (
            <tr key={index} className="border-t border-[#e4e7ef] align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={cn("px-3.5 py-2.5 text-[#3d3654]", cellIndex === 0 && "font-medium text-[#211a35]")}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A public document: title, the version in force and its date, a contents list, the text, and every
 * earlier version. `available` is false when staff have withdrawn it or not published it: then the
 * text is replaced by a notice and the contact path, never shown as if it were in force.
 */
export function DocumentView({ text, version, history, available, contact, extra }: { text: DocumentText; version: DocumentVersion; history: DocumentVersion[]; available: boolean; contact: string | null; extra?: React.ReactNode }) {
  return (
    <article className="px-5 pt-10 pb-20 sm:px-6 sm:pt-14 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          {available ? (
            <nav aria-label="On this page" className="hidden lg:block">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#667085] uppercase">On this page</p>
              <ol className="mt-3 grid gap-1.5 text-sm">
                {text.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="text-[#667085] hover:text-[#211a35]">
                      {section.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
        </aside>
        <div className="min-w-0 max-w-3xl">
          <p className="text-xs font-semibold tracking-[0.16em] text-[#5126c7] uppercase">Legal &amp; privacy</p>
          <h1 className="mt-3 font-heading text-4xl tracking-tight text-[#211a35] sm:text-5xl">{version.title}</h1>
          <p className="mt-4 text-sm text-[#667085]">
            {available ? <>In effect from {formatDay(version.effectiveOn)} · Version {version.id}</> : <>Being finalized</>}
          </p>
          {available ? (
            <>
              <p className="mt-6 text-lg leading-relaxed text-[#3d3654]">{text.lead}</p>
              {extra}
              <div className="mt-10 grid gap-12">
                {text.sections.map((section) => (
                  <section key={section.id} id={section.id} className="scroll-mt-24">
                    <h2 className="font-heading text-2xl tracking-tight text-[#211a35]">{section.heading}</h2>
                    <div className="mt-4 grid gap-4">
                      {section.blocks.map((block, index) => (
                        <BlockView key={index} block={block} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-8 rounded-2xl border border-[#e4e7ef] bg-white p-6">
              <p className="leading-relaxed text-[#3d3654]">This document is being finalized and is not in effect yet.</p>
              {contact ? (
                <p className="mt-3 leading-relaxed text-[#3d3654]">
                  Questions in the meantime:{" "}
                  <a href={`mailto:${contact}`} className="font-medium text-[#5126c7] underline underline-offset-4">
                    {contact}
                  </a>
                </p>
              ) : null}
            </div>
          )}
          <section aria-labelledby="history" className="mt-16 border-t border-[#e4e7ef] pt-8">
            <h2 id="history" className="text-sm font-semibold text-[#211a35]">
              Version history
            </h2>
            <ol className="mt-3 grid gap-2 text-sm text-[#667085]">
              {[...history].reverse().map((row) => (
                <li key={row.id} className="flex flex-wrap gap-x-3">
                  <span className="font-medium text-[#211a35]">{formatDay(row.effectiveOn)}</span>
                  <span>{row.summary}</span>
                  <span className="font-mono text-xs">{row.id}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </article>
  );
}
