"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { CheckCircle2, CircleDashed, Lock } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

const FEATURE_WORDS: Record<string, string> = {
  chat: "Company Chat",
  recruiter_mail: "Recruiter reading hiring mail",
  photo_review: "Photo review",
  video_review: "Video review",
  image_generate: "Image generation",
  image_edit: "Image editing",
  video_generate: "Video generation",
  embed: "Knowledge indexing",
  document_search: "Document search",
};

const SWITCHES = [
  { key: "imageGeneration", label: "Image generation", detail: "Creative Studio and chat may generate illustrative images, within the plan's allowance." },
  { key: "videoGeneration", label: "Video generation", detail: "Creative Studio and chat may generate short promotional videos, within the plan's allowance." },
  { key: "photoReview", label: "Photo review", detail: "Chat may send a visit's evidence photos to a model to describe what they show." },
  { key: "documentSearch", label: "Document search", detail: "Confirmed company knowledge and each person's own drafts are indexed so chat can search them." },
  { key: "otherChatModels", label: "Other chat models", detail: "People may choose models from OpenAI, Google, xAI and others in chat. Those go through OpenRouter, only to hosts that do not keep or train on the data. Claude models are always available." },
] as const;

const dollars = (micros: number) => `$${(micros / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const share = limit === null ? 0 : limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-strong tabular-nums">
        {used.toLocaleString("en-US")} <span className="text-sm font-normal text-muted-foreground">{limit === null ? "paid with credits" : `of ${limit.toLocaleString("en-US")}`}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : share > 0.8 ? "bg-warning" : "bg-brand-500")} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export function AiSettings() {
  const { companyId } = useCompany();
  const data = useQuery(api.ai.overview, { companyId });
  const save = useMutation(api.ai.setFeatures);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const toggle = (key: (typeof SWITCHES)[number]["key"]) => {
    setError(null);
    save({ companyId, ...data.features, [key]: !data.features[key] }).catch((caught: unknown) => setError(messageOf(caught)));
  };
  return (
    <div className="grid gap-5">
      <Panel title={`This month (${data.month}, ${data.plan === "expand" ? "Expand plan" : data.plan === "operate" ? "Operate plan" : "no plan"})`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Meter label="Chat answers" used={data.allowances.chat.used} limit={data.allowances.chat.limit} />
          <Meter label="Image generations" used={data.allowances.images.used} limit={data.allowances.images.limit} />
          <Meter label="Video generations" used={data.allowances.videos.used} limit={data.allowances.videos.limit} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">AI work is paid for with Selestial Credits; see Plan &amp; Usage for the balance. Image and video generation also have a monthly ceiling that resets at the start of each month (UTC).</p>
      </Panel>

      <Panel title="Usage by feature">
        {data.usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI use recorded this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Feature</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Calls</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Tokens in / out</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Media</th>
                  <th scope="col" className="py-1.5 font-medium">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((row) => (
                  <tr key={row.feature} className="border-t border-border">
                    <td className="py-1.5 pr-3 text-strong">{FEATURE_WORDS[row.feature] ?? row.feature}</td>
                    <td className="py-1.5 pr-3">
                      {row.calls}
                      {row.errors ? <span className="text-xs text-muted-foreground"> ({row.errors} not completed)</span> : null}
                    </td>
                    <td className="py-1.5 pr-3">{row.inputTokens || row.outputTokens ? `${row.inputTokens.toLocaleString("en-US")} / ${row.outputTokens.toLocaleString("en-US")}` : "—"}</td>
                    <td className="py-1.5 pr-3">{row.images ? `${row.images} image${row.images === 1 ? "" : "s"}` : row.videoSeconds ? `${row.videoSeconds}s video` : "—"}</td>
                    <td className="py-1.5">
                      {dollars(row.knownMicros)}
                      {row.unknownCost ? <span className="text-xs text-muted-foreground"> + {row.unknownCost} not priced</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Estimates come from the providers&apos; published rates. Where a rate is not published, the call is counted but not priced, rather than guessed.</p>
      </Panel>

      <Panel title="Features">
        <ul className="grid gap-2">
          {SWITCHES.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium text-strong">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.detail}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={data.features[item.key]}
                aria-label={item.label}
                disabled={!data.canChange}
                onClick={() => toggle(item.key)}
                className={cn("relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50", data.features[item.key] ? "border-brand-600 bg-brand-500" : "border-border bg-muted")}
              >
                <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-transform", data.features[item.key] ? "translate-x-5.5" : "translate-x-0.5")} />
              </button>
            </li>
          ))}
        </ul>
        {!data.canChange ? <p className="mt-2 text-xs text-muted-foreground">Only the Owner switches these.</p> : null}
        <FormError message={error} />
      </Panel>

      <Panel title="What is connected">
        <ul className="grid gap-1.5">
          {data.capabilities.map((row) => (
            <li key={row.capability} className="flex items-start gap-2.5 text-sm">
              {row.state === "ready" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : row.state === "not_implemented" ? <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
              <span className="min-w-0">
                <span className="font-medium text-strong">{row.label}</span>
                <span className="text-muted-foreground">{row.state === "ready" ? ` · ${row.provider} ${row.model}` : row.state === "not_implemented" ? " · not built" : row.state === "disabled" ? " · switched off by Selestial" : " · not connected yet"}</span>
                <span className="block text-xs text-muted-foreground">{row.dataNote}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Selestial chooses and connects the models. No company enters a provider key.</p>
      </Panel>
    </div>
  );
}
