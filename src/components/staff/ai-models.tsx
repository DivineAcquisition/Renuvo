"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { FormError, messageOf } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { CheckCircle2, CircleDashed, Lock } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";

const EVALUATIONS = [
  ["not_evaluated", "Not evaluated"],
  ["evaluating", "Evaluating"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
] as const;
type Evaluation = (typeof EVALUATIONS)[number][0];

const rate = (value: number | null | undefined, unit: string) => (value === null || value === undefined ? "not published" : `$${value} ${unit}`);

/**
 * Selestial's model settings, for staff. Keys are set on the deployment and never shown here; this says
 * only whether each provider is connected. Admins switch capabilities and record evaluations.
 */
export function AiModels() {
  const data = useQuery(api.aiAdmin.models, {});
  const set = useMutation(api.aiAdmin.setCapability);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <>
      <PageHeader title="AI models" lead="Which model serves each capability, whether its provider is connected, and where its evaluation stands. Keys are set on the deployment, never here." />
      <Panel title="Providers">
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {data.providers.map((row) => (
            <li key={row.provider} className="flex items-center gap-2">
              {row.connected ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleDashed className="size-4 text-warning" aria-hidden />}
              <span className="font-medium text-strong">{row.name}</span>
              <span className="text-muted-foreground">
                {row.connected ? "connected" : "not connected"} · <code className="text-xs">{row.key}</code>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Chat backup on OpenRouter: {data.openRouterChatModel ? <code>{data.openRouterChatModel}</code> : "none (set OPENROUTER_CHAT_MODEL to the exact OpenRouter model ID)"}. Used only for outages and rate limits.
        </p>
      </Panel>
      <FormError message={error} />
      <div className="mt-5 grid gap-3">
        {data.capabilities.map((row) => {
          const enabled = row.setting ? row.setting.enabled : !row.optional;
          const evaluation: Evaluation = row.setting?.evaluation ?? "not_evaluated";
          const update = (next: { enabled?: boolean; evaluation?: Evaluation }) => {
            setError(null);
            set({ capability: row.capability, enabled: next.enabled ?? enabled, evaluation: next.evaluation ?? evaluation }).catch((caught: unknown) => setError(messageOf(caught)));
          };
          return (
            <section key={row.capability} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                {row.state === "ready" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : row.state === "not_implemented" ? <Lock className="size-4 text-muted-foreground" aria-hidden /> : <CircleDashed className="size-4 text-warning" aria-hidden />}
                <h2 className="text-sm font-semibold text-strong">{row.label}</h2>
                <span className="text-xs text-muted-foreground">
                  {row.state === "ready" ? "ready" : row.state === "not_implemented" ? "not built" : row.state === "disabled" ? "switched off" : "provider not connected"}
                  {row.optional ? " · optional" : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <select aria-label={`Evaluation for ${row.label}`} value={evaluation} disabled={!row.implemented} onChange={(event) => update({ evaluation: event.target.value as Evaluation })} className="h-8 rounded-lg border border-border bg-card px-2 text-xs">
                    {EVALUATIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button type="button" role="switch" aria-checked={enabled} aria-label={`${row.label} on`} disabled={!row.implemented} onClick={() => update({ enabled: !enabled })} className={cn("relative inline-flex h-6 w-11 rounded-full border transition-colors disabled:opacity-40", enabled ? "border-brand-600 bg-brand-500" : "border-border bg-muted")}>
                    <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-5.5" : "translate-x-0.5")} />
                  </button>
                </span>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted-foreground">Model: </dt>
                  <dd className="inline font-mono text-strong">
                    {row.provider}:{row.model}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Verified: </dt>
                  <dd className="inline text-strong">{row.verification.state === "verified" ? `${row.verification.on} (${row.verification.how})` : `no (${row.verification.how})`}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Rates: </dt>
                  <dd className="inline text-strong">
                    {row.rates.perImage !== undefined ? rate(row.rates.perImage, "per image") : row.rates.perVideoSecond !== undefined ? rate(row.rates.perVideoSecond, "per second") : `${rate(row.rates.inputPerMTok, "/MTok in")}, ${rate(row.rates.outputPerMTok, "/MTok out")}`}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Fallback: </dt>
                  <dd className="inline text-strong">{row.fallback}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline text-muted-foreground">Data: </dt>
                  <dd className="inline text-strong">{row.dataNote}</dd>
                </div>
              </dl>
            </section>
          );
        })}
      </div>
    </>
  );
}
