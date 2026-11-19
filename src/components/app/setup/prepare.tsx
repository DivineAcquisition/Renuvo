"use client";

/**
 * Drafts setup can prepare for the owner's priority: a service, an agreement and a booking page. Each card
 * says what it is, what it was made from, what is still uncertain and what to decide next. They are drafts:
 * nothing here is published, approved or sent.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { ArrowUpRight, FileText, Globe, LayoutGrid, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Priority } from "../../../../convex/lib/setup/schema";

type Prepared = FunctionReturnType<typeof api.setup.state>["prepared"];

const TEMPLATE_FOR: Record<string, { id: string; label: string }> = {
  residential: { id: "res-standard", label: "Standard home cleaning" },
  commercial: { id: "com-office", label: "Office cleaning" },
  short_term_rental: { id: "str-turnover", label: "Short-term rental turnover" },
  property_management: { id: "pm-vacant", label: "Vacant unit clean" },
  post_construction: { id: "pc-final", label: "Post-construction final clean" },
  specialty: { id: "sp-windows", label: "Window cleaning" },
};
const AGREEMENT_FOR: Record<string, { docType: "one_time_residential" | "office_janitorial" | "str_turnover"; label: string }> = {
  residential: { docType: "one_time_residential", label: "One-time residential cleaning agreement" },
  commercial: { docType: "office_janitorial", label: "Office cleaning agreement" },
  short_term_rental: { docType: "str_turnover", label: "Short-term rental turnover agreement" },
};
const BOOKING_FOR: Record<string, { kind: "residential" | "commercial" | "short_term_rental"; label: string }> = {
  residential: { kind: "residential", label: "Home cleaning booking page" },
  commercial: { kind: "commercial", label: "Office and commercial request page" },
  short_term_rental: { kind: "short_term_rental", label: "Short-term rental intake page" },
};

/** Which drafts help each priority. Agent work itself is prepared in the next phase. */
const DRAFTS_FOR: Record<Priority, ("service" | "agreement" | "booking")[]> = {
  pricing: ["service"],
  booking: ["service", "agreement", "booking"],
  sales: ["service", "booking"],
  dispatch: [],
  recruiter: [],
  retention: [],
};

function Card({ icon: Icon, title, state, children }: { icon: typeof FileText; title: string; state: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="grid gap-2 rounded-xl border border-border p-3.5">
      <header className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
          <Icon className="size-4" />
        </span>
        <h3 className="font-medium text-strong">{title}</h3>
        <span className="ml-auto">{state}</span>
      </header>
      <div className="grid gap-2 text-sm text-muted-foreground">{children}</div>
    </article>
  );
}

export function PrepareDrafts({ priority, secondary, categories, prepared }: { priority: Priority | null; secondary: Priority[]; categories: string[]; prepared: Prepared }) {
  const { companyId } = useCompany();
  const website = useQuery(api.setupWebsite.status, { companyId });
  const prepareService = useMutation(api.setup.prepareService);
  const prepareAgreement = useMutation(api.setup.prepareAgreement);
  const prepareBooking = useMutation(api.setup.prepareBooking);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kinds = new Set([...(priority ? DRAFTS_FOR[priority] : []), ...secondary.flatMap((value) => DRAFTS_FOR[value])]);
  if (kinds.size === 0) return null;
  const main = categories.find((value) => TEMPLATE_FOR[value]) ?? "residential";
  const template = TEMPLATE_FOR[main];
  const agreement = AGREEMENT_FOR[main] ?? AGREEMENT_FOR.residential;
  const booking = BOOKING_FOR[main] ?? BOOKING_FOR.residential;
  const found = website?.status === "ready" ? website.services : [];

  async function act(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid gap-2.5" aria-labelledby="drafts-heading">
      <h2 id="drafts-heading" className="text-sm font-semibold text-strong">
        Drafts for your first work
      </h2>
      {kinds.has("service") ? (
        <Card icon={Sparkles} title={prepared.service ? prepared.service.name : "Your first service"} state={prepared.service ? <Badge variant="warning">Draft · not published</Badge> : <Badge variant="outline">Not prepared</Badge>}>
          {prepared.service ? (
            <>
              <p>Started from Selestial&apos;s {template.label.toLowerCase()} starting point. Its prices are examples until you set your own; customers see nothing until you publish it.</p>
              <Button variant="outline" size="sm" className="justify-self-start" render={<Link href={prepared.service.href} />}>
                Open and set your prices
                <ArrowUpRight aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <p>One service is enough to start: it gives Sales a price to quote from once you publish it. Until then, customers can still ask for a quote.</p>
              {found.length ? (
                <div className="grid gap-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-strong">
                    <Globe className="size-3.5" aria-hidden />
                    On your website
                  </p>
                  {found.slice(0, 4).map((service) => (
                    <div key={service.name} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-strong">{service.name}</span>
                        {service.advertised ? <span className="block text-xs">Advertised as “{service.advertised}”. That is not used as a price: you set the price in the draft.</span> : null}
                      </span>
                      <Button variant="outline" size="xs" loading={busy === service.name} onClick={() => void act(service.name, () => prepareService({ companyId, templateId: (service.category && TEMPLATE_FOR[service.category]?.id) || template.id, name: service.name }))}>
                        Prepare this one
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button variant={found.length ? "ghost" : "outline"} size="sm" className="justify-self-start" loading={busy === "template"} onClick={() => void act("template", () => prepareService({ companyId, templateId: template.id }))}>
                Start from {template.label.toLowerCase()}
              </Button>
            </>
          )}
        </Card>
      ) : null}
      {kinds.has("agreement") ? (
        <Card icon={FileText} title={prepared.agreement ? prepared.agreement.title : agreement.label} state={prepared.agreement ? <Badge variant="warning">Draft prepared · not reviewed</Badge> : <Badge variant="outline">Not prepared</Badge>}>
          <p>{prepared.agreement ? "Selestial's starting text, filled with what it knows about your company. It is a starting point, not legal advice: read it, change what you need, and approve it before it is sent to anyone." : "Start from Selestial's starting text for your main kind of work. You answer a few questions about your terms in the agreement itself."}</p>
          {prepared.agreement ? (
            <Button variant="outline" size="sm" className="justify-self-start" render={<Link href={prepared.agreement.href} />}>
              Open and review
              <ArrowUpRight aria-hidden />
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="justify-self-start" loading={busy === "agreement"} onClick={() => void act("agreement", () => prepareAgreement({ companyId, docType: agreement.docType }))}>
              Prepare the draft
            </Button>
          )}
        </Card>
      ) : null}
      {kinds.has("booking") ? (
        <Card icon={LayoutGrid} title={prepared.booking ? prepared.booking.name : booking.label} state={prepared.booking ? <Badge variant="warning">Draft · not published</Badge> : <Badge variant="outline">Not prepared</Badge>}>
          <p>
            {prepared.booking
              ? prepared.booking.canTakeBookings
                ? "Ready to review in the builder. It goes live only when you publish it."
                : "It can take bookings once one of your services is published. Until then it can't be published, and customers can still ask for a quote."
              : "A booking page with your services and branding, ready to review in the builder. You don't need to design anything now."}
          </p>
          {prepared.booking ? (
            <Button variant="outline" size="sm" className="justify-self-start" render={<Link href={prepared.booking.href} />}>
              Open the preview
              <ArrowUpRight aria-hidden />
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="justify-self-start" loading={busy === "booking"} onClick={() => void act("booking", () => prepareBooking({ companyId, kind: booking.kind }))}>
              Prepare the draft
            </Button>
          )}
        </Card>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-strong" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The website read as it happens: each page as it is read, then what was found. */
export function WebsiteProgress() {
  const { companyId } = useCompany();
  const read = useQuery(api.setupWebsite.status, { companyId });
  const stop = useMutation(api.setupWebsite.stop);
  if (!read) return null;
  const running = read.status === "queued" || read.status === "reading";
  return (
    <div className="grid gap-2 rounded-xl border border-border px-3 py-2.5 text-sm" aria-live="polite">
      <p className="flex items-center gap-2 font-medium text-strong">
        <Globe className="size-4 text-brand-600" aria-hidden />
        {running ? `Reading ${read.host}` : read.status === "ready" ? `Read ${read.pages.filter((page) => page.ok).length} pages of ${read.host}` : read.status === "stopped" ? "You stopped the reading" : `Couldn't read ${read.host}`}
        {running ? (
          <button type="button" className="ml-auto text-xs font-medium text-brand-700 underline-offset-4 hover:underline dark:text-brand-300" onClick={() => void stop({ companyId, readId: read.readId })}>
            Stop
          </button>
        ) : null}
      </p>
      <ul className="grid gap-0.5 text-xs text-muted-foreground">
        {read.pages.slice(-5).map((page) => (
          <li key={`${page.url}-${page.at}`} className="truncate">
            {page.ok ? "✓" : "–"} {page.title || new URL(page.url).pathname}
            {page.note ? ` (${page.note})` : ""}
          </li>
        ))}
        {running && read.pages.length === 0 ? <li>Opening your home page…</li> : null}
      </ul>
      {read.status === "ready" ? <p className="text-xs text-muted-foreground">{read.found ? `${read.found} details found. They are suggestions until you confirm them.` : "Nothing we could use with confidence. Enter your details yourself."}</p> : null}
      {read.status === "failed" ? <p className="text-xs text-muted-foreground">{read.problem}</p> : null}
    </div>
  );
}
