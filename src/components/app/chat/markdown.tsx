"use client";

import Link from "next/link";
import { Fragment, useMemo } from "react";

import { parseMarkdown, type Block, type Inline } from "@/lib/app/chat/markdown";
import { cn } from "@/lib/utils";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "text":
            return <Fragment key={index}>{node.text}</Fragment>;
          case "br":
            return <br key={index} />;
          case "strong":
            return (
              <strong key={index} className="font-semibold text-strong">
                <Inlines nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inlines nodes={node.children} />
              </em>
            );
          case "code":
            return (
              <code key={index} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-strong">
                {node.text}
              </code>
            );
          case "confirm":
            return (
              <mark key={index} className="rounded-md border border-dashed border-warning/60 bg-warning/10 px-1.5 py-0.5 text-[0.92em] font-medium text-warning-foreground">
                <span className="sr-only">To confirm: </span>
                {node.text}
              </mark>
            );
          case "link":
            return node.href.startsWith("/") ? (
              <Link key={index} href={node.href} className="font-medium text-brand-300 underline underline-offset-4 hover:text-brand-200">
                <Inlines nodes={node.children} />
              </Link>
            ) : (
              <a key={index} href={node.href} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-300 underline underline-offset-4 hover:text-brand-200">
                <Inlines nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (["h3", "h3", "h4", "h5"] as const)[block.level - 1];
      return (
        <Tag className={cn("font-heading tracking-tight text-strong", block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm")}>
          <Inlines nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap">
          <Inlines nodes={block.children} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag start={block.ordered ? block.start : undefined} className={cn("grid gap-1 pl-5", block.ordered ? "list-decimal" : block.items.some((item) => item.checked !== null) ? "list-none pl-0" : "list-disc")}>
          {block.items.map((item, index) => (
            <li key={index} className="pl-0.5 marker:text-muted-foreground">
              {item.checked !== null ? (
                <span className="flex items-start gap-2">
                  <span aria-hidden className={cn("mt-1 inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px]", item.checked ? "border-brand-500 bg-brand-500 text-white" : "border-border")}>
                    {item.checked ? "✓" : ""}
                  </span>
                  <span>
                    <span className="sr-only">{item.checked ? "Done: " : "To do: "}</span>
                    <Inlines nodes={item.children} />
                  </span>
                </span>
              ) : (
                <Inlines nodes={item.children} />
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre className="overflow-x-auto rounded-xl bg-[var(--an-code-background)] p-3 font-mono text-xs leading-relaxed text-[var(--an-code-color)]">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-brand-500/40 pl-3 text-muted-foreground">
          <Inlines nodes={block.children} />
        </blockquote>
      );
    case "rule":
      return <hr className="border-border" />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-muted/60">
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" className="px-3 py-2 font-semibold text-strong" style={{ textAlign: block.align[index] ?? undefined }}>
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-border">
                  {row.map((cell, index) => (
                    <td key={index} className="px-3 py-2 tabular-nums" style={{ textAlign: block.align[index] ?? undefined }}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Markdown as React elements. Nothing in the text is ever treated as HTML. */
export function Markdown({ source, className, streaming }: { source: string; className?: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={cn("an-markdown grid gap-2.5 text-[14.5px] leading-relaxed text-foreground", className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
      {streaming ? <span aria-hidden className="-mt-2 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand-400/70" /> : null}
    </div>
  );
}
