"use client";

/**
 * The page an agent that is not released yet opens to: what it will do, shown working on an example, the
 * capabilities it will have under the tabs already in the sidebar, what is usable today, and a request for
 * early access. Asking records interest for Selestial's team; it turns nothing on and buys nothing.
 */
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { AgentScene, Mock } from "@/components/agents/scene";
import { agentPortrait, eyebrow } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { ArrowRight, Bell, BellRing, CheckCircle2, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Capability, ComingSoonAgent } from "@/lib/app/coming-soon";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

export function ComingSoonAgentPage({ agent }: { agent: ComingSoonAgent }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-6 [&>*]:min-w-0">
      <Hero agent={agent} />
      <AgentScene agent={agent} footer="Like every Selestial agent, it will work under the permissions you set in Settings, and its work shows in Approvals and Activity." />
      <section aria-labelledby="capabilities" className="grid gap-3">
        <h2 id="capabilities" className="font-heading text-lg tracking-tight text-strong">
          What {agent.name} will do
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
          {agent.capabilities.map((capability, index) => (
            <CapabilityCard key={capability.tab} capability={capability} index={index} />
          ))}
        </ul>
      </section>
      {agent.availableNow?.length ? (
        <section aria-labelledby="now" className="grid gap-3 rounded-2xl border border-success/30 bg-success/[0.06] p-4 sm:p-5">
          <h2 id="now" className="flex items-center gap-2 text-sm font-semibold text-strong">
            <CheckCircle2 aria-hidden className="size-4 text-success-foreground" />
            Available today
          </h2>
          {agent.availableNow.map((row) => (
            <Link key={row.path} href={row.path} className="group flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 hover:border-brand-500/40">
              <span>
                <span className="block text-sm font-medium text-strong">{row.label}</span>
                <span className="block text-sm text-muted-foreground">{row.detail}</span>
              </span>
              <ArrowRight aria-hidden className="size-4 text-brand-300 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </section>
      ) : null}
      <RequestAccess agent={agent} />
    </div>
  );
}

function Hero({ agent }: { agent: ComingSoonAgent }) {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-border bg-card px-5 py-8 sm:px-8 sm:py-10">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_15%_0%,color-mix(in_oklab,var(--color-brand-500)_22%,transparent),transparent)]" />
      <div aria-hidden className="absolute -right-24 -bottom-24 -z-10 size-72 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
        <div className="relative mx-auto size-24 sm:size-28 md:mx-0">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand-500/15 [animation-duration:3s] motion-reduce:animate-none" />
          <Image src={agentPortrait(agent.id)} alt="" width={224} height={224} priority className="relative size-full rounded-full object-cover ring-2 ring-brand-500/40" />
        </div>
        <div className="min-w-0 text-center md:text-left">
          <p className={cn(eyebrow, "flex items-center justify-center gap-2 md:justify-start")}>
            <Sparkles aria-hidden className="size-3.5" />
            {agent.department} · Coming soon
          </p>
          <h1 className="mt-1 font-heading text-3xl tracking-tight text-strong sm:text-4xl">{agent.name}</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base md:mx-0">{agent.pitch}</p>
          <p className="mt-2 text-xs text-muted-foreground">{agent.plan}</p>
        </div>
        <div className="flex justify-center md:justify-end">
          <a href="#early-access" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
            <Bell aria-hidden className="size-4" />
            Request early access
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Capabilities ─────────────────────────────────────────────────────────────────────────────────────

function CapabilityCard({ capability, index }: { capability: Capability; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
      className="group grid content-start gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-brand-500/40"
    >
      <div aria-hidden className="h-32 overflow-hidden rounded-xl border border-border bg-background p-3">
        <Mock kind={capability.mock} />
      </div>
      <div className="grid gap-1 px-1 pb-1">
        <p className="text-[11px] font-semibold tracking-wide text-brand-300 uppercase">{capability.tab}</p>
        <p className="text-sm font-semibold text-strong">{capability.title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{capability.detail}</p>
      </div>
    </motion.li>
  );
}

// ── Early access ────────────────────────────────────────────────────────────────────────────────────

function RequestAccess({ agent }: { agent: ComingSoonAgent }) {
  const { companyId } = useCompany();
  const mine = useQuery(api.agentAccess.mine, { companyId, agent: agent.id });
  const request = useMutation(api.agentAccess.request);
  const withdraw = useMutation(api.agentAccess.withdraw);
  const { busy, error, run } = useRun();
  const [uses, setUses] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const asked = mine?.requested && mine.mine && !editing;
  return (
    <section id="early-access" aria-labelledby="early-access-title" className="scroll-mt-24 rounded-2xl border border-brand-500/30 bg-card p-4 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <p className={eyebrow}>Early access</p>
          <h2 id="early-access-title" className="mt-1 font-heading text-xl tracking-tight text-strong">
            Want {agent.name} sooner?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Tell us what you&apos;d use it for. Selestial invites a few companies to try each agent before it&apos;s released, and what you tell us shapes what it does first. Asking turns nothing on, changes nothing on your plan and buys nothing.
          </p>
          {mine?.requested ? (
            <p className="mt-3 text-sm text-strong">
              {mine.status === "invited"
                ? `Selestial has invited ${agent.name} for your company. The Owner will hear from us about getting started.`
                : `${mine.people === 1 ? (mine.mine ? "You've" : `${mine.names?.[0] ?? "Someone"} has`) : `${mine.people} people at your company have`} asked for early access.`}
            </p>
          ) : null}
        </div>
        {asked ? (
          <div className="grid content-start gap-3 rounded-xl border border-success/40 bg-success/[0.07] p-4" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-strong">
              <BellRing aria-hidden className="size-4 text-success-foreground" />
              You&apos;re on the early access list
            </p>
            <p className="text-sm text-muted-foreground">We&apos;ll tell your company&apos;s Owner when {agent.name} is ready to try. You don&apos;t need to do anything else.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Change what I&apos;d use it for
              </Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => withdraw({ companyId, agent: agent.id }))}>
                Take my name off
              </Button>
            </div>
            <FormError message={error} />
          </div>
        ) : (
          <form
            className="grid content-start gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await request({ companyId, agent: agent.id, uses, ...(note.trim() ? { note } : {}) });
                setEditing(false);
              });
            }}
          >
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-strong">What would you use it for? (optional)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {agent.capabilities.map((capability) => {
                  const on = uses.includes(capability.title);
                  return (
                    <label key={capability.title} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm", on ? "border-brand-500 bg-brand-500/[0.08] text-strong" : "border-border text-muted-foreground hover:text-strong")}>
                      <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={on} onChange={() => setUses(on ? uses.filter((use) => use !== capability.title) : [...uses, capability.title])} />
                      {capability.title}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="grid gap-1 text-sm font-medium text-strong">
              Anything else we should know? (optional)
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="For example: we lose a few customers a month to missed tasks, and want every visit checked." className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-strong placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-brand-500" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" loading={busy} disabled={mine === undefined}>
                <Bell aria-hidden />
                {mine?.requested && !mine.mine ? "Add my name to the request" : editing ? "Save" : "Request early access"}
              </Button>
              {editing ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
            <FormError message={error} />
          </form>
        )}
      </div>
    </section>
  );
}
