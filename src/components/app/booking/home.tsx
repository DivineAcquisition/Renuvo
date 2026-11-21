"use client";

/**
 * Growth → Sales → Booking Forms: every booking experience, the bookings coming through them, and the
 * shared booking rules. The page is titled Booking Experiences; the tab keeps its name and address.
 */
import { ArrowSquareOut, Buildings, CalendarCheck, Copy, House, Megaphone, Plus, Repeat, Sliders, Sparkle, Warning } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Empty, Notice } from "@/components/app/services/shared";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EXPERIENCE_KINDS, KIND_LABELS, type ExperienceKind } from "../../../../convex/lib/booking/definition";
import { BookingRules } from "./rules";
import { Checkbox } from "@/components/ui/selection";

const ROOT = "/app/agents/sales/booking-forms";
const KIND_ICONS: Record<ExperienceKind, React.ReactNode> = {
  residential: <House aria-hidden className="size-5" weight="duotone" />,
  commercial: <Buildings aria-hidden className="size-5" weight="duotone" />,
  short_term_rental: <CalendarCheck aria-hidden className="size-5" weight="duotone" />,
  recurring: <Repeat aria-hidden className="size-5" weight="duotone" />,
  campaign: <Megaphone aria-hidden className="size-5" weight="duotone" />,
};
const STATUS: Record<string, { label: string; variant: "success" | "outline" | "warning" }> = { published: { label: "Published", variant: "success" }, draft: { label: "Draft", variant: "outline" }, unpublished: { label: "Unpublished", variant: "warning" }, archived: { label: "Archived", variant: "outline" } };
const SESSION_WORDS: Record<string, string> = { active: "In progress", requested: "Request sent", confirmed: "Confirmed", needs_attention: "Needs a person", abandoned: "Stopped", expired: "Link ended", cancelled: "Cancelled" };
const STEP_WORDS: Record<string, string> = { location: "location", size: "size", service: "service and time", details: "details", checkout: "checkout", confirmation: "confirmation" };

export function BookingFormsHome() {
  const { companyId, role } = useCompany();
  const overview = useQuery(api.bookingExperiences.overview, { companyId });
  const params = useSearchParams();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const panel = params.get("panel");
  const canDraft = role === "owner" || role === "manager";

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-300">Sales · Booking Forms</p>
          <h1 className="mt-1 font-heading text-2xl tracking-tight text-strong">Booking Experiences</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Pages customers book on, with your services, prices, times, deposits and agreements. Each experience has a public link, a draft you can test, and published versions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={panel === "rules" ? ROOT : `${ROOT}?panel=rules`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Sliders aria-hidden /> Booking rules
          </Link>
          {canDraft ? (
            <button type="button" onClick={() => setCreating(true)} className={buttonVariants({ variant: "primary", size: "sm" })}>
              <Plus aria-hidden /> New experience
            </button>
          ) : null}
        </div>
      </header>

      {panel === "rules" ? <BookingRules onClose={() => router.push(ROOT)} /> : null}

      {overview === undefined ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <>
          {overview.needsAttention > 0 ? (
            <Notice tone="warning" title={`${overview.needsAttention} paid booking${overview.needsAttention === 1 ? "" : "s"} need${overview.needsAttention === 1 ? "s" : ""} a person`}>
              The customer paid but the booking couldn&apos;t be confirmed. Each has a task in Approvals with what happened.
            </Notice>
          ) : null}
          {!overview.handle && canDraft ? (
            <Notice tone="info" title="Choose your booking address">
              Your pages will live at {overview.linkBase}
              <em>your-name</em>/…{" "}
              <Link href={`${ROOT}?panel=rules`} className="font-medium text-brand-300 hover:underline">
                Set it in the booking rules
              </Link>
              .
            </Notice>
          ) : null}
          {!overview.plan ? <Notice tone="warning" title="Publishing needs an active plan">Booking pages are part of the Operate and Expand plans.</Notice> : null}
          {overview.experiences.length === 0 ? (
            <Empty title="No booking experiences yet" action={canDraft ? <button type="button" onClick={() => setCreating(true)} className={buttonVariants({ variant: "primary", size: "sm" })}><Plus aria-hidden /> Create your first</button> : undefined}>
              Start from a residential booking, a commercial walkthrough request, a short-term rental turnover, recurring enrollment or a campaign page. Each starts from the services you have published.
            </Empty>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overview.experiences.map((x) => (
                <ExperienceCard key={x.id} x={x} canDraft={canDraft} />
              ))}
            </ul>
          )}
          <Sessions />
        </>
      )}
      <NewExperience open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ExperienceCard({ x, canDraft }: { x: { id: Id<"bookingExperiences">; name: string; kind: ExperienceKind; kindLabel: string; status: string; url: string | null; publishedVersion: number | null; draftDiffers: boolean; updatedAt: number; draftSavedBy: string; started: number; confirmed: number; requests: number; mode: string; brandColor: string; services: number }; canDraft: boolean }) {
  const { companyId } = useCompany();
  const duplicate = useMutation(api.bookingExperiences.duplicate);
  const router = useRouter();
  const status = STATUS[x.status] ?? STATUS.draft;
  const [copied, setCopied] = useState(false);
  return (
    <li className="group relative flex flex-col rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-xl text-white" style={{ background: x.brandColor }}>
          {KIND_ICONS[x.kind]}
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <Link href={`${ROOT}/${x.id}`} className="mt-3 font-heading text-base font-medium tracking-tight text-strong after:absolute after:inset-0 hover:underline">
        {x.name}
      </Link>
      <p className="text-sm text-muted-foreground">
        {x.kindLabel} · {x.mode === "instant" ? "books instantly" : "sends a request"} · {x.services} service{x.services === 1 ? "" : "s"}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[["Started", x.started], ["Booked", x.confirmed], ["Requests", x.requests]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg bg-muted/50 px-2 py-1.5">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="text-sm font-medium tabular-nums text-strong">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[11px] text-muted-foreground">Last 30 days, test bookings left out.</p>
      <div className="relative z-10 mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        {x.url ? (
          <>
            <a href={x.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "xs" })}>
              <ArrowSquareOut aria-hidden /> Open
            </a>
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(x.url!).catch(() => undefined); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} className={buttonVariants({ variant: "outline", size: "xs" })}>
              <Copy aria-hidden /> {copied ? "Copied" : "Copy link"}
            </button>
          </>
        ) : null}
        {canDraft ? (
          <button type="button" onClick={async () => { const id = await duplicate({ companyId, experienceId: x.id }); router.push(`${ROOT}/${id}`); }} className={buttonVariants({ variant: "ghost", size: "xs" })}>
            Duplicate
          </button>
        ) : null}
        {x.draftDiffers && x.publishedVersion ? <span className="ml-auto self-center text-[11px] text-warning-foreground">Draft has unpublished changes</span> : null}
      </div>
    </li>
  );
}

function NewExperience({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.bookingExperiences.create);
  const router = useRouter();
  const { busy, error, run } = useRun();
  return (
    <Modal open={open} onClose={onClose} title="New booking experience" description="Each starts from the reference booking layout and your published services. You can change everything before publishing.">
      <div className="grid gap-2">
        {EXPERIENCE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const id = await create({ companyId, kind });
                router.push(`${ROOT}/${id}`);
              })
            }
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-brand-500/50 hover:bg-brand-500/[0.04] disabled:opacity-60"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-300">{KIND_ICONS[kind]}</span>
            <span>
              <span className="block text-sm font-medium text-strong">{KIND_LABELS[kind].label}</span>
              <span className="block text-sm text-muted-foreground">{KIND_LABELS[kind].blurb}</span>
            </span>
          </button>
        ))}
        <FormError message={error} />
      </div>
    </Modal>
  );
}

function Sessions() {
  const { companyId, role } = useCompany();
  const rows = useQuery(api.bookingExperiences.sessions, { companyId });
  const recover = useMutation(api.bookingExperiences.sendRecovery);
  const revoke = useMutation(api.bookingExperiences.revokeLink);
  const [showTests, setShowTests] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { error, run } = useRun();
  const canAct = role === "owner" || role === "manager";
  if (rows === undefined) return <div className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />;
  const shown = rows.filter((r) => r.test === showTests);
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base tracking-tight text-strong">Recent bookings</h2>
          <p className="text-sm text-muted-foreground">Each state is kept apart: paid isn&apos;t confirmed, and confirmed isn&apos;t a cleaner accepting.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={showTests} onCheckedChange={(checked) => setShowTests(checked)} /> Test bookings
        </label>
      </header>
      {notice ? <Notice tone="info" title={notice} className="mb-3">{" "}</Notice> : null}
      <FormError message={error} />
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No {showTests ? "test " : ""}bookings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Where it stands</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">Payment</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="py-2 pr-3">
                    <span className="block font-medium text-strong">{r.name ?? "Not given yet"}</span>
                    {r.totalCents ? <span className="text-xs text-muted-foreground">${(r.totalCents / 100).toFixed(2)}</span> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={cn("inline-flex items-center gap-1 text-strong", r.status === "needs_attention" && "text-warning-foreground")}>
                      {r.status === "needs_attention" ? <Warning aria-hidden className="size-4" /> : null}
                      {SESSION_WORDS[r.status] ?? r.status}
                    </span>
                    {r.status === "active" ? <span className="block text-xs text-muted-foreground">Reached {STEP_WORDS[r.step] ?? r.step}</span> : null}
                    {r.blockers.length && r.status !== "confirmed" ? <span className="block max-w-[260px] text-xs text-muted-foreground">{r.blockers[0]}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.when ?? "—"}<span className="block text-xs">{r.states.capacity === "held" ? "Held" : r.states.capacity === "committed" ? "Reserved" : r.states.capacity === "requested" ? "Preferred only" : r.states.capacity === "expired" ? "Hold ended" : ""}</span></td>
                  <td className="py-2 pr-3 text-muted-foreground">{{ not_required: "None now", pending: "Not started", started: "Started", processing: "Processing", succeeded: "Received", failed: "Didn't go through", simulated: "Simulated" }[r.states.payment] ?? r.states.payment}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.campaign ? `${r.source ?? ""} · ${r.campaign}` : (r.source ?? "Direct")}</td>
                  <td className="py-2 text-right">
                    <span className="flex flex-wrap justify-end gap-1">
                      {r.jobId ? (
                        <Link href={`/app/agents/dispatch/dispatch-board?job=${r.jobId}`} className={buttonVariants({ variant: "outline", size: "xs" })}>
                          Visit
                        </Link>
                      ) : null}
                      {r.invoiceId && role === "owner" ? (
                        <Link href={`/app/finance?tab=invoices&invoice=${r.invoiceId}`} className={buttonVariants({ variant: "outline", size: "xs" })}>
                          Invoice
                        </Link>
                      ) : null}
                      {canAct && r.canRecover ? (
                        <button type="button" onClick={() => void run(async () => { const res = await recover({ companyId, sessionId: r.id }); setNotice(res.status === "queued" || res.status === "held" ? "Reminder queued." : `Not sent: ${res.problem ?? "the sending rules refused it."}`); })} className={buttonVariants({ variant: "secondary", size: "xs" })}>
                          <Sparkle aria-hidden /> Send reminder
                        </button>
                      ) : null}
                      {canAct && !r.test && (r.status === "active" || r.status === "confirmed") ? (
                        <button type="button" onClick={() => void run(async () => { await revoke({ companyId, sessionId: r.id }); setNotice("The customer's link was ended."); })} className={buttonVariants({ variant: "ghost", size: "xs" })}>
                          End link
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
