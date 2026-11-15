"use client";

import Link from "next/link";
import { useState } from "react";

import { AgentAvatar, STATE } from "@/components/app/agent";
import { ActivityFeed } from "@/components/app/overview/activity-feed";
import { presenceLine, type TeamAgent, type TeamDepartment } from "@/components/app/overview/team-at-work";
import { ChevronDown, X } from "@/components/icons";
import { BorderBeam } from "@/components/ui/border-beam";
import { linkTo } from "@/lib/app/navigation-helpers";
import { cn } from "@/lib/utils";

import type { Described, EventRef } from "../../../convex/lib/eventWords";

/** One line for the whole team: what is moving, what is waiting, what is with you. */
export function teamLine(agents: TeamAgent[]): string {
  const built = agents.filter((agent) => agent.state !== "not_built");
  if (built.length === 0) return "No agent is working yet";
  if (built.every((agent) => agent.state === "paused")) return "Your team is paused";
  const total = (key: "open" | "waiting" | "needsDecision") => built.reduce((sum, agent) => sum + agent.counts[key], 0);
  const parts = [total("needsDecision") ? `${total("needsDecision")} with you` : "", total("open") ? `${total("open")} in progress` : "", total("waiting") ? `${total("waiting")} waiting` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing open right now";
}

/**
 * The team console. It stays on every page: closed, it shows who is working and whether anything is
 * with you; open, it shows what each agent is doing right now and the last things the team did.
 */
export function AgentDock({ departments, activity, now, timezone, onOpen }: { departments: TeamDepartment[]; activity?: Described[]; now: number; timezone: string; onOpen: (ref: EventRef) => void }) {
  const [open, setOpen] = useState(false);
  const agents = departments.flatMap((department) => department.agents);
  const built = agents.filter((agent) => agent.state !== "not_built");
  const later = agents.filter((agent) => agent.state === "not_built");
  const needsYou = built.some((agent) => agent.state === "needs_you");
  const working = built.some((agent) => agent.state === "working");
  const pick = (ref: EventRef) => {
    setOpen(false);
    onOpen(ref);
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-30 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5">
      {open ? (
        <section aria-label="Your team" className="live-enter pointer-events-auto flex max-h-[min(34rem,calc(100dvh-7rem))] w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_24px_60px_-20px_rgba(15,131,114,0.35)] sm:w-[23rem]">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="font-heading text-base tracking-tight text-strong">Your team</h2>
              <p className="text-xs text-muted-foreground">{teamLine(agents)}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the team console" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="grid gap-1 p-2">
              {built.map((agent) => {
                const first = agent.lines[0];
                const body = (
                  <>
                    <AgentAvatar agent={agent.agent} state={agent.state} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5 text-sm">
                        <span className="font-medium text-strong">{agent.name}</span>
                        <span className={cn("text-xs", agent.state === "needs_you" ? "font-medium text-warning-foreground" : "text-muted-foreground")}>{STATE[agent.state].label}</span>
                      </span>
                      <span className={cn("block text-xs leading-relaxed text-muted-foreground", agent.state === "working" && "live-shimmer-text")}>{presenceLine(agent, now, timezone)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={agent.agent}>
                    {first ? (
                      <button type="button" onClick={() => pick({ kind: "task", id: first.taskId })} className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-start gap-3 px-2 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {later.length > 0 ? (
              <p className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                {later.map((agent) => (
                  <AgentAvatar key={agent.agent} agent={agent.agent} state="not_built" size="xs" />
                ))}
                {later.map((agent) => agent.name).join(", ")}: not built yet
              </p>
            ) : null}
            <div className="border-t border-border px-4 py-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Latest</p>
              <div className="mt-1">{activity ? <ActivityFeed events={activity.slice(0, 6)} now={now} timezone={timezone} onOpen={pick} empty="Nothing has happened yet." /> : null}</div>
            </div>
          </div>
          <footer className="border-t border-border px-4 py-2.5">
            <Link href={linkTo("settings") ?? "/app"} onClick={() => setOpen(false)} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
              Agent permissions and pause are in Settings
            </Link>
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={cn(
          "pointer-events-auto relative inline-flex h-12 items-center gap-2.5 overflow-hidden rounded-full border bg-background py-1.5 pr-3.5 pl-2 text-sm shadow-[0_12px_32px_-12px_rgba(15,131,114,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          needsYou ? "border-warning/60" : "border-brand-500/40",
        )}
      >
        {needsYou || working ? <BorderBeam size={50} duration={needsYou ? 6 : 4} colorFrom={needsYou ? "#f0b45c" : "#2cc5a8"} colorTo="#6fdfc8" borderWidth={2} /> : null}
        <span className="flex -space-x-1.5">
          {agents.map((agent) => (
            <AgentAvatar key={agent.agent} agent={agent.agent} state={agent.state} size="sm" />
          ))}
        </span>
        <span className="text-left leading-tight">
          <span className="block text-xs font-semibold text-strong">Your team</span>
          <span className={cn("block text-[11px]", needsYou ? "font-medium text-warning-foreground" : "text-muted-foreground")}>{teamLine(agents)}</span>
        </span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open ? "" : "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}
