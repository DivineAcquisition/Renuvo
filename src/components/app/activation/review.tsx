"use client";

/**
 * What Selestial will start, before the Owner starts it: each task, the agent doing it, what it reads,
 * what it makes, the permission that governs anything it would send, and what it may cost. Tasks that
 * can't run yet say exactly why. Used by setup's last step and by "Start my first agent tasks" on Home.
 */
import { useQuery } from "convex/react";

import { AgentAvatar, type AgentId } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { Check, Coins, Info, ShieldCheck } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Priority } from "../../../../convex/lib/setup/schema";
import { StateBadge } from "./shared";

export function ActivationReview({ focus, secondary }: { focus?: Priority | null; secondary?: Priority[] }) {
  const { companyId } = useCompany();
  const preview = useQuery(api.activation.preview, { companyId, ...(focus ? { focus } : {}), ...(secondary ? { secondary } : {}) });
  if (preview === undefined) {
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Preparing your plan">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }
  if (!preview.focus) return <p className="rounded-xl border border-border p-3.5 text-sm text-muted-foreground">Choose what Selestial should focus on first, and the work it would start appears here.</p>;
  const now = preview.tasks.filter((t) => t.state === "queued");
  const later = preview.tasks.filter((t) => t.state !== "queued");
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-brand-500/5 to-transparent p-4">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-600 uppercase">Your focus</p>
        <p className="mt-1 font-display text-lg font-semibold text-strong">{preview.focus.words}</p>
        <p className="mt-1 text-sm text-muted-foreground">{preview.focus.lead}</p>
      </div>

      {now.length ? <TaskGroup title={`Starts now · ${now.length}`} tasks={now} /> : null}
      {later.length ? <TaskGroup title={`Prepared, but waiting on something · ${later.length}`} tasks={later} muted /> : null}

      {preview.budget ? (
        <div className="grid gap-1.5 rounded-xl border border-border bg-card p-3.5 text-sm">
          <p className="flex items-center gap-2 font-medium text-strong">
            <Coins className="size-4 text-brand-600" aria-hidden />
            What this may use
          </p>
          <p className="text-muted-foreground">{preview.budget.words.estimate}</p>
          <p className="text-muted-foreground">{preview.budget.words.allowance}</p>
        </div>
      ) : null}

      <div className="grid gap-1.5 rounded-xl border border-border bg-card p-3.5 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-strong">
          <ShieldCheck className="size-4 text-brand-600" aria-hidden />
          What stays yours
        </p>
        <p>Creating a draft, publishing it and sending it are separate. Selestial creates drafts; publishing a service, a booking page or a role, changing a price, or issuing a refund still needs you. Anything an agent sends follows the permissions you set, and is checked again at the moment it goes.</p>
      </div>

      {preview.notBuilt.length ? (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Not part of this plan: {preview.notBuilt.map((row) => `${row.name} (${row.words.replace(/\.$/, "").toLowerCase()})`).join("; ")}. Nothing is prepared or sent in their name.</span>
        </p>
      ) : null}
    </div>
  );
}

type PreviewTask = NonNullable<ReturnType<typeof useQuery<typeof api.activation.preview>>>["tasks"][number];

function TaskGroup({ title, tasks, muted }: { title: string; tasks: PreviewTask[]; muted?: boolean }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="grid gap-2">
        {tasks.map((task) => (
          <li key={task.template} className={cn("grid gap-2 rounded-xl border border-border bg-card p-3.5", muted && "bg-muted/30")}>
            <div className="flex flex-wrap items-start gap-3">
              <AgentAvatar agent={task.agent as AgentId} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {task.agentName}
                  {task.priority === 1 ? " · your focus" : " · supporting"}
                </p>
                <p className="font-medium text-strong">{task.title}</p>
              </div>
              <StateBadge state={task.state} />
            </div>
            <p className="text-sm text-muted-foreground">{task.objective}</p>
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-medium text-strong">You&apos;ll get</dt>
                <dd className="text-muted-foreground">{task.expectedOutput}</dd>
              </div>
              <div>
                <dt className="font-medium text-strong">Permission</dt>
                <dd className="text-muted-foreground">{task.authority.words}</dd>
              </div>
              <div>
                <dt className="font-medium text-strong">Reads</dt>
                <dd className="text-muted-foreground">{task.sources.map((s) => `${s.label}: ${s.count}`).join(" · ") || "Your confirmed answers"}</dd>
              </div>
              <div>
                <dt className="font-medium text-strong">Cost</dt>
                <dd className="text-muted-foreground">{task.estimate.words}</dd>
              </div>
            </dl>
            {task.prerequisites.length ? (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {task.prerequisites.map((p) => (
                  <li key={p.words} className={cn("flex items-center gap-1", p.met ? "text-success-foreground" : "text-muted-foreground")}>
                    {p.met ? <Check className="size-3" aria-hidden /> : <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />}
                    {p.words}
                  </li>
                ))}
              </ul>
            ) : null}
            {task.blocker ? (
              <p className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-strong">
                {task.blocker.words}{" "}
                <a href={task.blocker.action.href} className="font-medium text-brand-600 underline-offset-4 hover:underline">
                  {task.blocker.action.label}
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
