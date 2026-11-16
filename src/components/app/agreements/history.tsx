"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Notice } from "@/components/app/agreements/shared";
import type { Detail } from "@/components/app/agreements/types";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { when } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/** Every saved version, who made it and why, and a side-by-side comparison of any two. */
export function Versions({ detail, onOpen }: { detail: Detail; onOpen: (version: number) => void }) {
  const { companyId, timezone } = useCompany();
  const [pair, setPair] = useState<{ from: number; to: number } | null>(null);
  const diff = useQuery(api.companyAgreements.compare, pair ? { companyId, agreementId: detail.id, from: pair.from, to: pair.to } : "skip");
  const latest = detail.versions[0]?.version ?? 1;
  return (
    <div className="grid gap-4">
      <Panel title="Versions">
        <p className="mb-3 text-sm text-muted-foreground">A saved version never changes. A new answer or edit is a new version, and approval and signatures name the exact version they were given.</p>
        <ul className="divide-y divide-border">
          {detail.versions.map((row) => (
            <li key={row.version} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-strong">Version {row.version}</span>
                {row.version === detail.approvedVersion ? <span className="ml-2 text-xs text-success-foreground">approved</span> : null}
                {row.version === detail.signedVersion ? <span className="ml-2 text-xs text-success-foreground">signed</span> : null}
                {row.version === detail.sentVersion ? <span className="ml-2 text-xs text-warning-foreground">sent</span> : null}
                <span className="block text-xs text-muted-foreground">
                  {row.author === "assistant" ? "Selestial, in Chat" : row.author === "system" ? "System" : "A team member"}, {when(row.createdAt, timezone)} · {row.note ?? "No note"} · #{row.hash}
                  {row.unresolved ? ` · ${row.unresolved} to confirm` : ""}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onOpen(row.version)}>Open</Button>
                {row.version > 1 ? <Button size="sm" variant="secondary" onClick={() => setPair({ from: row.version - 1, to: row.version })}>What changed</Button> : null}
                {row.version !== latest ? <Button size="sm" variant="secondary" onClick={() => setPair({ from: row.version, to: latest })}>Compare to latest</Button> : null}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      {pair ? (
        <Panel title={`Version ${pair.from} to version ${pair.to}`} action={<Button size="sm" variant="ghost" onClick={() => setPair(null)}>Close</Button>}>
          {!diff ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{diff.added} line{diff.added === 1 ? "" : "s"} added, {diff.removed} removed.</p>
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-3 text-[0.8125rem] leading-relaxed" aria-label="Changes between versions">
                {diff.lines.filter((l) => l.kind !== "same" || diff.lines.length < 60).map((line, index) => (
                  <span key={index} className={cn("block px-1", line.kind === "added" && "bg-success/15 text-strong", line.kind === "removed" && "bg-destructive/10 text-strong line-through decoration-destructive/50")}>
                    <span aria-hidden className="select-none text-muted-foreground">{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}</span>
                    {line.text || " "}
                  </span>
                ))}
              </pre>
              {diff.lines.length >= 60 ? <p className="mt-1 text-xs text-muted-foreground">Unchanged lines are hidden.</p> : null}
            </>
          )}
        </Panel>
      ) : null}
      <Panel title="Where this text came from">
        <p className="text-sm text-strong">
          {detail.sourceTemplate ? (detail.sourceTemplate.kind === "company" ? `Your template, version ${detail.sourceTemplate.version}` : `Selestial's starting text for ${detail.typeLabel}`) : "Written from scratch"}
        </p>
        {detail.clauses.length ? (
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {detail.clauses.map((c) => (
              <li key={c.key}>{detail.kitClauses.find((k) => k.key === c.key)?.title ?? c.key} <span className="opacity-70">· clause v{c.version}</span></li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">An uploaded or hand-written document has no clause library behind it.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">A copy of these clauses is kept with the agreement. Editing a template or Selestial&apos;s library later does not change this document.</p>
      </Panel>
    </div>
  );
}

export function Activity({ detail }: { detail: Detail }) {
  const { companyId, timezone } = useCompany();
  const rows = useQuery(api.companyAgreements.activity, { companyId, agreementId: detail.id });
  if (!rows) return <Skeleton className="h-40 rounded-2xl" />;
  if (rows.length === 0) return <Notice>Nothing has happened yet.</Notice>;
  return (
    <Panel flush>
      <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">What happened, and who did it. This list records actions, never the document&apos;s words or a note&apos;s text.</p>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2.5 text-sm sm:px-5">
            <span className="text-strong"><span className="font-medium">{row.who}</span> {row.text}{row.version ? ` (version ${row.version})` : ""}</span>
            <time className="text-xs text-muted-foreground" dateTime={new Date(row.at).toISOString()}>{when(row.at, timezone)}</time>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
