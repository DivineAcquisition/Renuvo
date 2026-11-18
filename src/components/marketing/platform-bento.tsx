import type { ReactNode } from "react";

import {
  BroomIcon,
  ChatIcon,
  CheckCircle2,
  FileTextIcon,
  Hand,
  HouseIcon,
  MapPin,
  PriceTagIcon,
  ReceiptIcon,
  StudioIcon,
  type LucideIcon,
} from "@/components/icons";
import { SpotlightCard } from "@/components/marketing/saas-frame";
import { buttonVariants } from "@/components/ui/button-variants";
import { EXAMPLE_LABEL, PLATFORM } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const C = PLATFORM.cards;
const inset = "rounded-lg border border-border bg-background";

function Card({ icon: Icon, title, body, className, children }: { icon: LucideIcon; title: string; body: string; className?: string; children: ReactNode }) {
  return (
    <SpotlightCard className={cn("p-5 sm:p-6", className)}>
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300" aria-hidden>
            <Icon className="size-4" />
          </span>
          <h3 className="font-heading text-base tracking-tight text-strong sm:text-lg">{title}</h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-4 flex-1" aria-hidden>
          {children}
        </div>
      </div>
    </SpotlightCard>
  );
}

function Pricing() {
  return (
    <div className={cn(inset, "p-3.5")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-strong">{C.pricing.service}</p>
        <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          {C.pricing.status}
        </span>
      </div>
      <dl className="mt-3 grid gap-1.5 text-sm">
        {C.pricing.lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="text-strong tabular-nums">{line.value}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2 font-semibold">
          <dt className="text-strong">{C.pricing.total.label}</dt>
          <dd className="text-strong tabular-nums">{C.pricing.total.value}</dd>
        </div>
      </dl>
    </div>
  );
}

function Booking() {
  return (
    <div className={cn(inset, "grid gap-3 p-3.5")}>
      <p className="text-sm font-semibold text-strong">{C.booking.service}</p>
      <div className="grid grid-cols-2 gap-2">
        {C.booking.fields.map((field) => (
          <div key={field.label} className="rounded-md border border-border bg-card px-2.5 py-1.5">
            <p className="text-[11px] text-muted-foreground">{field.label}</p>
            <p className="text-sm font-medium text-strong">{field.value}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-heading text-xl tracking-tight text-strong tabular-nums">{C.booking.price}</p>
        <span className={cn(buttonVariants({ variant: "gradient", size: "sm" }), "pointer-events-none")}>{C.booking.cta}</span>
      </div>
    </div>
  );
}

function Clients() {
  return (
    <div className={cn(inset, "p-3.5")}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">ML</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-strong">{C.clients.name}</span>
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3" />
            {C.clients.property}
          </span>
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {C.clients.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-strong">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

const CLEANER_TONE: Record<string, string> = { Available: "bg-success", "On a job": "bg-brand-400", "Off tomorrow": "bg-muted-foreground/50" };

function Cleaners() {
  return (
    <ul className="grid gap-1.5">
      {C.cleaners.rows.map((row) => (
        <li key={row.name} className={cn(inset, "flex items-center justify-between gap-3 px-3 py-2")}>
          <span className="text-sm font-medium text-strong">{row.name}</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", CLEANER_TONE[row.state])} />
            {row.state}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Finance() {
  return (
    <div className={cn(inset, "flex items-center justify-between gap-3 p-3.5")}>
      <span>
        <span className="block text-xs text-muted-foreground">{C.finance.invoice}</span>
        <span className="block font-heading text-xl tracking-tight text-strong tabular-nums">{C.finance.amount}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success-foreground">
        <CheckCircle2 className="size-3.5" />
        {C.finance.status}
      </span>
    </div>
  );
}

function Approvals() {
  return (
    <div className={cn(inset, "p-3.5")}>
      <p className="text-sm text-strong">{C.approvals.request}</p>
      <div className="mt-3 flex gap-2">
        <span className={cn(buttonVariants({ variant: "primary", size: "sm" }), "pointer-events-none")}>{C.approvals.approve}</span>
        <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none")}>{C.approvals.decline}</span>
      </div>
    </div>
  );
}

function Chat() {
  return (
    <div className="grid gap-2">
      <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand-500/10 px-3 py-2 text-sm text-strong">{C.chat.question}</p>
      <p className="max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2 text-sm text-strong">{C.chat.answer}</p>
    </div>
  );
}

function Agreements() {
  return (
    <div className={cn(inset, "flex items-center justify-between gap-3 p-3.5")}>
      <span className="flex min-w-0 items-center gap-2 text-sm text-strong">
        <FileTextIcon className="size-4 shrink-0 text-brand-300" />
        <span className="truncate">{C.agreements.name}</span>
      </span>
      <span className="shrink-0 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success-foreground">{C.agreements.status}</span>
    </div>
  );
}

/**
 * The workspace the agents share with the team, as a bento of small screens. Every figure is made up and
 * the grid says so once.
 */
export function PlatformBento() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Card icon={PriceTagIcon} title={C.pricing.title} body={C.pricing.body} className="lg:col-span-3">
          <Pricing />
        </Card>
        <Card icon={StudioIcon} title={C.booking.title} body={C.booking.body} className="lg:col-span-3">
          <Booking />
        </Card>
        <Card icon={HouseIcon} title={C.clients.title} body={C.clients.body} className="lg:col-span-2">
          <Clients />
        </Card>
        <Card icon={BroomIcon} title={C.cleaners.title} body={C.cleaners.body} className="lg:col-span-2">
          <Cleaners />
        </Card>
        <Card icon={ReceiptIcon} title={C.finance.title} body={C.finance.body} className="lg:col-span-2">
          <Finance />
        </Card>
        <Card icon={Hand} title={C.approvals.title} body={C.approvals.body} className="lg:col-span-2">
          <Approvals />
        </Card>
        <Card icon={ChatIcon} title={C.chat.title} body={C.chat.body} className="lg:col-span-2">
          <Chat />
        </Card>
        <Card icon={FileTextIcon} title={C.agreements.title} body={C.agreements.body} className="lg:col-span-2">
          <Agreements />
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{EXAMPLE_LABEL}: made-up names and figures.</p>
    </div>
  );
}
