"use client";

/**
 * The pieces a client's pages are built from. Each shows one record's facts in words: a visit's booking,
 * crew and outcome stay separate; an agent's card moves only when an agent is really working.
 */
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";

import { AgentAvatar } from "@/components/app/agent";
import { useDetail } from "@/components/app/detail-panel";
import { ArrowUpRight, CalendarIcon, Mail, MapPin, Phone } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { CADENCE_LABELS, clientPath, PROPERTY_KIND_LABELS, propertyPath } from "@/lib/app/clients";
import { cn } from "@/lib/utils";

import type { api } from "../../../../convex/_generated/api";
import { arrival, Card, day, money, PropertyKindIcon, StaffingLine, when } from "./bits";

type Summary = FunctionReturnType<typeof api.clients.summary>;
type Profile = FunctionReturnType<typeof api.clients.profile>;
export type Visit = Summary["upcoming"][number];
export type PropertyRow = Profile["properties"][number];
export type ContactRow = Profile["contacts"][number];

/** A button that opens the shared detail panel for a visit, task or approval, keeping the page's address. */
export function OpenDetail({ kind, id, children, className }: { kind: "job" | "task" | "approval"; id: string; children: React.ReactNode; className?: string }) {
  const open = useDetail();
  return (
    <button type="button" onClick={() => open({ kind, id } as never)} className={className ?? "inline-flex items-center gap-1 text-sm font-medium text-brand-300 underline-offset-4 hover:underline"}>
      {children}
    </button>
  );
}

/** The next visit: what, where, when, the arrival window, the scope, and the crew as it really stands. */
export function NextServiceCard({ visit, timezone, onBook }: { visit: Visit | null; timezone: string; onBook?: () => void }) {
  if (!visit) {
    return (
      <Card title="Next service">
        <p className="text-sm text-muted-foreground">Nothing is booked.</p>
        {onBook ? (
          <button type="button" onClick={onBook} className="mt-2 text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            Book a visit
          </button>
        ) : null}
      </Card>
    );
  }
  return (
    <Card
      title="Next service"
      action={
        <OpenDetail kind="job" id={visit.id}>
          Open the visit <ArrowUpRight aria-hidden className="size-3.5" />
        </OpenDetail>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="grid h-fit place-items-center rounded-xl bg-brand-500/10 px-4 py-2.5 text-center text-brand-300">
          <span className="text-xs font-medium uppercase">{new Date(visit.startsAt).toLocaleDateString("en-US", { weekday: "short", timeZone: timezone })}</span>
          <span className="font-heading text-2xl leading-none tabular-nums">{new Date(visit.startsAt).toLocaleDateString("en-US", { day: "numeric", timeZone: timezone })}</span>
          <span className="text-xs">{new Date(visit.startsAt).toLocaleDateString("en-US", { month: "short", timeZone: timezone })}</span>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <p className="font-medium text-strong">
            {visit.service} <span className="font-normal text-muted-foreground">at {visit.property}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {day(visit.startsAt, timezone)}, {arrival(visit.startsAt, visit.arrivalWindowMinutes, timezone)}
            {visit.planId ? " · from a plan" : ""}
          </p>
          {visit.scope ? <p className="line-clamp-2 text-sm text-strong">{visit.scope}</p> : null}
          <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Booking</dt>
              <dd className="text-strong">{visit.outcome}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Crew</dt>
              <dd>
                <StaffingLine staffing={visit.staffing} />
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">Payment is in Finance and is never inferred from the visit.</p>
        </div>
      </div>
    </Card>
  );
}

/** A visit in a list: date, service, property, booking and crew. Opens the existing visit panel. */
export function VisitRow({ visit, timezone, showProperty = true }: { visit: Visit; timezone: string; showProperty?: boolean }) {
  return (
    <li>
      <OpenDetail kind="job" id={visit.id} className="grid w-full gap-1 rounded-xl border border-border px-3 py-2.5 text-left text-sm transition-colors hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
        <span className="text-strong tabular-nums">{when(visit.startsAt, timezone)}</span>
        <span className="min-w-0">
          <span className="font-medium text-strong">{visit.service}</span>
          {showProperty ? <span className="text-muted-foreground"> · {visit.property}</span> : null}
          {visit.staffing ? (
            <span className="block">
              <StaffingLine staffing={visit.staffing} />
            </span>
          ) : null}
        </span>
        <Badge variant={visit.outcome === "Skipped" || visit.outcome === "Cancelled" ? "outline" : visit.status === "completed" ? "success" : "info"} size="sm">
          {visit.outcome}
        </Badge>
      </OpenDetail>
    </li>
  );
}

/** A plan or standing arrangement in brief. */
export function PlanSummary({ plan, timezone, customerId }: { plan: Summary["plans"][number]; timezone: string; customerId: string }) {
  const state = plan.state === "active" ? "Running" : plan.state === "paused" ? "Paused" : plan.state === "setup" ? "Being set up" : "Ended";
  return (
    <li className="rounded-xl border border-border px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-strong">
            {plan.service}
            <span className="font-normal text-muted-foreground"> · {plan.property}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {plan.kind === "standing" ? "Standing arrangement: turnovers are booked one by one" : plan.cadence ? CADENCE_LABELS[plan.cadence] : "Recurring"}
            {plan.priceCents !== null ? ` · ${money(plan.priceCents)} a ${plan.kind === "standing" ? "turnover" : "visit"}` : ""}
            {plan.nextAt ? ` · next ${day(plan.nextAt, timezone)}` : ""}
          </p>
        </div>
        <Badge variant={plan.state === "active" ? "success" : plan.state === "paused" ? "warning" : "outline"} size="sm">
          {state}
        </Badge>
      </div>
      <Link href={`${clientPath(customerId, "services")}?view=plans&plan=${plan.id}`} className="mt-1 inline-block text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
        Open the plan
      </Link>
    </li>
  );
}

/** Something that needs a person: what, why, when, and the action it suggests. */
export function AttentionCard({ item, timezone, customerId, onAction }: { item: Summary["attention"][number]; timezone: string; customerId: string; onAction?: (item: Summary["attention"][number]) => void }) {
  const detail = item.ref.kind === "job" || item.ref.kind === "task" ? { kind: item.ref.kind, id: item.ref.id } : null;
  const href = detail ? null : item.ref.kind === "plan" ? `${clientPath(customerId, "services")}?view=plans&plan=${item.ref.id}` : item.ref.id === "new" ? null : propertyPath(customerId, item.ref.id);
  return (
    <li className="rounded-xl border border-warning/40 bg-warning/[0.06] px-3 py-2.5 text-sm">
      <p className="font-medium text-strong">{item.title}</p>
      <p className="text-muted-foreground">{item.detail}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
        <span className="text-muted-foreground">{when(item.at, timezone)}</span>
        {detail ? (
          <OpenDetail kind={detail.kind} id={detail.id} className="font-medium text-brand-300 underline-offset-4 hover:underline">
            {item.action}
          </OpenDetail>
        ) : href ? (
          <Link href={href} scroll={false} className="font-medium text-brand-300 underline-offset-4 hover:underline">
            {item.action}
          </Link>
        ) : onAction ? (
          <button type="button" onClick={() => onAction(item)} className="font-medium text-brand-300 underline-offset-4 hover:underline">
            {item.action}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One piece of work Selestial (or a person) holds for this client. The agent's mark is still unless an
 * agent that exists, and is not paused, is actually working the task.
 */
export function AgentCard({ card, timezone }: { card: Summary["handling"][number]; timezone: string }) {
  return (
    <li className="rounded-xl border border-border px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2.5">
        <AgentAvatar agent={card.agent} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-strong">{card.title}</p>
            <Badge variant={card.state === "Needs approval" || card.state === "Needs a decision" ? "warning" : card.agentWorking ? "info" : "outline"} size="sm">
              {card.agentWorking ? (
                <span aria-hidden className="mr-0.5 inline-block size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
              ) : null}
              {card.state}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">With: {card.owner}</p>
          {card.trigger ? <p className="mt-1 text-muted-foreground">What happened: {card.trigger}</p> : null}
          {card.next ? <p className="mt-1 text-strong">Next: {card.next}</p> : null}
          {card.blocker ? <p className="mt-1 text-warning-foreground">{card.blocker}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
            <span className="text-muted-foreground">Due {when(card.dueAt, timezone)}</span>
            <OpenDetail kind={card.approvalId ? "approval" : "task"} id={card.approvalId ?? card.id} className="font-medium text-brand-300 underline-offset-4 hover:underline">
              {card.approvalId ? "Review the approval" : "Inspect the work"}
            </OpenDetail>
          </div>
        </div>
      </div>
    </li>
  );
}

/** A property in brief, with its readiness and next service where known. */
export function PropertyCard({ property, customerId, nextAt, timezone, className }: { property: PropertyRow; customerId: string; nextAt?: number | null; timezone: string; className?: string }) {
  const d = property.details as Record<string, unknown>;
  const facts =
    property.kind === "short_term_rental"
      ? [d.beds ? `${d.beds} beds` : null, d.laundry === "on_site" ? "Laundry on site" : d.laundry === "off_site" ? "Laundry off site" : null, d.checkoutTime && d.checkinTime ? `Turnover ${d.checkoutTime}–${d.checkinTime}` : null]
      : property.kind === "office" || property.kind === "commercial"
        ? [d.squareFeet ? `${Number(d.squareFeet).toLocaleString()} sq ft` : null, d.serviceWindow ? `Service ${(d.serviceWindow as { from: string; to: string }).from}–${(d.serviceWindow as { from: string; to: string }).to}` : null]
        : [d.bedrooms ? `${d.bedrooms} bed` : null, d.bathrooms ? `${d.bathrooms} bath` : null, d.squareFeet ? `${Number(d.squareFeet).toLocaleString()} sq ft` : null];
  const missing = property.kind === "short_term_rental" ? !d.beds : property.kind === "home" ? !d.bedrooms : false;
  return (
    <Link href={propertyPath(customerId, property.id)} className={cn("group grid min-w-0 gap-2 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50", property.status === "archived" && "opacity-70", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-300">
          <PropertyKindIcon kind={property.kind} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-strong group-hover:underline group-hover:underline-offset-4">{property.name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin aria-hidden className="size-3 shrink-0" />
            {property.address.line1}
            {property.address.line2 ? `, ${property.address.line2}` : ""}, {property.address.city}
          </p>
        </div>
        {property.status === "archived" ? (
          <Badge variant="outline" size="sm" className="shrink-0">
            Archived
          </Badge>
        ) : null}
      </div>
      <p className="text-xs text-strong">{[PROPERTY_KIND_LABELS[property.kind], ...facts].filter(Boolean).join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {nextAt ? (
          <span className="inline-flex items-center gap-1 text-strong">
            <CalendarIcon aria-hidden className="size-3.5" /> Next {day(nextAt, timezone)}
          </span>
        ) : (
          <span className="text-muted-foreground">Nothing booked</span>
        )}
        {missing ? <span className="text-warning-foreground">Size not recorded</span> : null}
        {property.hasAccessInstructions ? <span className="text-muted-foreground">Access instructions on file</span> : null}
      </div>
    </Link>
  );
}

const ROLE_WORDS: Record<string, string> = { primary: "Primary", billing: "Billing", signer: "Signer", site: "Site contact" };

/** The client's contacts and their roles. */
export function ContactList({ contacts, properties, onEdit }: { contacts: ContactRow[]; properties: PropertyRow[]; onEdit?: (contact: ContactRow) => void }) {
  return (
    <ul className="grid gap-2">
      {contacts.map((contact) => (
        <li key={contact.id} className="rounded-xl border border-border px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-strong">{contact.name}</p>
              {contact.title ? <p className="text-xs text-muted-foreground">{contact.title}</p> : null}
            </div>
            {onEdit ? (
              <button type="button" onClick={() => onEdit(contact)} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline" aria-label={`Edit ${contact.name}`}>
                Edit
              </button>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {contact.roles.map((role) => (
              <span key={role} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-strong">
                {ROLE_WORDS[role]}
              </span>
            ))}
          </div>
          <div className="mt-1.5 grid gap-0.5 text-xs">
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 text-strong hover:underline">
                <Phone aria-hidden className="size-3.5 text-muted-foreground" /> {contact.phone}
              </a>
            ) : null}
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 break-all text-strong hover:underline">
                <Mail aria-hidden className="size-3.5 text-muted-foreground" /> {contact.email}
              </a>
            ) : null}
            {contact.roles.includes("site") && contact.propertyIds.length ? <span className="text-muted-foreground">For {contact.propertyIds.map((id) => properties.find((p) => p.id === id)?.name ?? "a property").join(", ")}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What happened, newest first, in words. */
export function Timeline({ items, timezone }: { items: Summary["activity"]; timezone: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <ol className="relative grid gap-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-border">
      {items.map((item) => (
        <li key={item.id} className="relative pl-5 text-sm">
          <span aria-hidden className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-card bg-brand-500/60" />
          <p className="text-strong">
            <span className="font-medium">{item.actor}</span> {item.text}
          </p>
          <p className="text-xs text-muted-foreground">{when(item.at, timezone)}</p>
        </li>
      ))}
    </ol>
  );
}
