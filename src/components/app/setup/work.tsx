"use client";

/**
 * Each agent's first work in setup. The runs start when the owner reaches this step; each card shows what its
 * run is doing while it is scheduled, then what it found: what it used, what is still uncertain, the records
 * it points at and the next decision. Readiness sits beside the work and is never replaced by it.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { ArrowUpRight, Loader2, RefreshCw } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";

type Row = FunctionReturnType<typeof api.setupWork.status>[number];
type Agent = Row["agent"];

const TONE = { ready_to_work: "success", waiting_for_information: "warning", connection_needed: "info", plan_needed: "info", paused: "outline", not_available: "outline" } as const;
const WORDS = { ready_to_work: "Ready to work", waiting_for_information: "Waiting for information", connection_needed: "Connection needed", plan_needed: "Plan needed", paused: "Paused", not_available: "Not available yet" } as const;

export function AgentWork({ first, canEdit, hiringBrief }: { first: Agent | null; canEdit: boolean; hiringBrief: boolean }) {
  const { companyId } = useCompany();
  const rows = useQuery(api.setupWork.status, { companyId });
  const begin = useMutation(api.setupWork.start);
  const asked = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Arriving here starts the work once, if it has never run. Running it again is the owner's choice.
  useEffect(() => {
    if (!rows || !canEdit || asked.current || rows.some((row) => row.work)) return;
    asked.current = true;
    begin({ companyId }).catch((caught) => setError(messageOf(caught)));
  }, [rows, canEdit, begin, companyId]);

  if (!rows) return null;
  const ordered = [...rows].sort((a, b) => Number(b.agent === first) - Number(a.agent === first));
  return (
    <div className="grid gap-2.5">
      {ordered.map((row) => (
        <WorkCard key={row.agent} row={row} canEdit={canEdit} hiringBrief={hiringBrief} />
      ))}
      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-strong" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function WorkCard({ row, canEdit, hiringBrief }: { row: Row; canEdit: boolean; hiringBrief: boolean }) {
  const { companyId } = useCompany();
  const begin = useMutation(api.setupWork.start);
  const brief = useMutation(api.setup.prepareHiringBrief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = row.work;
  const result = work?.result ?? null;

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="grid min-w-0 gap-2 rounded-xl border border-border p-3.5" aria-label={row.name}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-strong">{row.name}</h3>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {work?.status === "ready_for_review" ? <Badge variant="info">Ready for review</Badge> : null}
          <Badge variant={TONE[row.readiness.state]}>{WORDS[row.readiness.state]}</Badge>
        </span>
      </header>

      {!work || work.status === "preparing" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {work?.activity ?? "Waiting to start"}…
        </p>
      ) : work.status === "failed" ? (
        <p className="text-sm text-strong" role="alert">
          {work.problem}
        </p>
      ) : result ? (
        <div className="grid min-w-0 gap-2 text-sm">
          <p>
            <span className="font-medium text-strong">{result.title}.</span> <span className="text-muted-foreground">{result.summary}</span>
          </p>
          {result.items.length ? (
            <ul className="grid gap-1" aria-label={`What ${row.name} found`}>
              {result.items.map((item) => (
                <li key={`${item.label}-${item.detail}`} className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                  {item.href ? (
                    <Link href={item.href} className="font-medium text-strong hover:underline">
                      {item.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-strong">{item.label}</span>
                  )}
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {result.used.length || result.uncertain.length ? (
            <dl className="grid gap-1 text-xs text-muted-foreground">
              {result.used.length ? (
                <div>
                  <dt className="inline font-medium text-strong">Used: </dt>
                  <dd className="inline">{result.used.join(" · ")}</dd>
                </div>
              ) : null}
              {result.uncertain.length ? (
                <div>
                  <dt className="inline font-medium text-strong">Still open: </dt>
                  <dd className="inline">{result.uncertain.join(" ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {row.agent === "recruiter" && !hiringBrief && canEdit && row.readiness.state !== "plan_needed" && row.readiness.state !== "paused" ? (
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void act(async () => {
                    await brief({ companyId });
                    await begin({ companyId, agent: "recruiter" });
                  })
                }
              >
                Prepare a hiring brief
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left" render={<Link href={result.next.href} />}>
                {result.next.words}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Button>
            )}
            {canEdit ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => begin({ companyId, agent: row.agent }))}>
                <RefreshCw className="size-3.5" aria-hidden />
                Check again
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {work?.status === "failed" && canEdit ? (
        <Button variant="outline" size="sm" className="self-start" loading={busy} onClick={() => void act(() => begin({ companyId, agent: row.agent }))}>
          Prepare again
        </Button>
      ) : null}
      {error ? (
        <p className="text-sm text-strong" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
