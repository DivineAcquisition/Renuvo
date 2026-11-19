"use client";

/**
 * "Your first work": the workspace arrival after setup. It shows the chosen priority, what is prepared, what
 * waits for a decision, what agents actually sent, what still blocks the priority, and one next step. Every
 * count is read from records; a section with nothing in it says so or is left out.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowRight, ArrowUpRight, CheckCircle2, Hourglass, SendIcon as Send, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";
import { PRIORITY_INFO } from "../../../../convex/lib/setup/path";

const NAMES = { sales: "Sales", dispatch: "Dispatch", recruiter: "Recruiter", retention: "Retention" } as const;

export function FirstWork() {
  const { companyId } = useCompany();
  const work = useQuery(api.setup.firstWork, { companyId });
  if (work === undefined) return <Skeleton className="mx-auto mt-8 h-96 w-full max-w-3xl rounded-2xl" />;
  if (work === null)
    return (
      <div className="mx-auto grid max-w-3xl gap-3 px-4 py-10">
        <p className="text-sm text-muted-foreground">This company didn&apos;t go through setup, so there is no first work to show.</p>
        <Button variant="primary" className="justify-self-start" render={<Link href="/app" />}>
          Open workspace
        </Button>
      </div>
    );
  const info = PRIORITY_INFO.find((item) => item.id === work.priority);
  const waiting = work.waiting.firstBatch + work.waiting.approvals;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="grid gap-2">
        <p className="text-xs font-medium tracking-wide text-brand-600 uppercase dark:text-brand-300">Your first work</p>
        <h1 className="font-heading text-2xl tracking-tight text-strong sm:text-3xl">{info ? info.title : "Your workspace is ready"}</h1>
        <p className="text-sm text-muted-foreground">Everything here is counted from your records right now.</p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/8 p-4 sm:p-5" aria-labelledby="next-heading">
        <h2 id="next-heading" className="flex items-center gap-2 text-sm font-semibold text-strong">
          <Sparkles className="size-4 text-brand-600" aria-hidden />
          Recommended next step
        </h2>
        <p className="text-lg font-medium text-strong">{work.next.words}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" render={<Link href={work.next.href} />}>
            Do this now
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" render={<Link href="/app" />}>
            Open workspace
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Count icon={CheckCircle2} value={work.prepared.length + work.reviews.length} words="prepared for you" />
        <Count icon={Hourglass} value={waiting} words={waiting === 1 ? "waits for your decision" : "wait for your decision"} />
        <Count icon={Send} value={work.started.messages} words={work.started.messages === 1 ? "message your agents sent" : "messages your agents sent"} />
      </div>

      {work.prepared.length || work.reviews.length ? (
        <Section title="Prepared">
          {work.prepared.map((item) => (
            <Row key={item.href + item.label} label={item.label} detail={item.detail} href={item.href} />
          ))}
          {work.reviews.map((review) => (
            <Row key={review.agent} label={`${NAMES[review.agent]}: ${review.title}`} detail={review.summary} href={review.next.href} />
          ))}
        </Section>
      ) : null}

      {waiting ? (
        <Section title="Waiting for you">
          {work.waiting.firstBatch ? <Row label={`Sales's first ${work.waiting.firstBatch === 1 ? "message" : `${work.waiting.firstBatch} messages`}`} detail="Nothing goes out until you send or set aside each one." href="/app/agents/sales" /> : null}
          {work.waiting.approvals ? <Row label={`${work.waiting.approvals} ${work.waiting.approvals === 1 ? "approval" : "approvals"}`} detail="Work your agents prepared and are holding for you." href="/app/approvals" /> : null}
        </Section>
      ) : null}

      <Section title="Started">
        <p className="px-1 text-sm text-muted-foreground">{work.started.messages ? `Your agents have sent ${work.started.messages} ${work.started.messages === 1 ? "message" : "messages"} since setup began, each one after the checks it needs.` : "Nothing has been sent to anyone yet. Your agents act only as you allow."}</p>
      </Section>

      {work.blockers.length ? (
        <Section title="Still in the way">
          {work.blockers.map((gap) => (
            <Row key={gap.words} label={gap.next} detail={gap.words} href={gap.href} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Count({ icon: Icon, value, words }: { icon: typeof Send; value: number; words: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 text-sm text-muted-foreground">
        <span className="block text-xl font-semibold text-strong tabular-nums">{value}</span>
        {words}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h2 className="text-sm font-semibold text-strong">{title}</h2>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}

function Row({ label, detail, href }: { label: string; detail: string; href: string }) {
  return (
    <Link href={href} className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-sm hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-strong">{label}</span>
        <span className="block text-muted-foreground">{detail}</span>
      </span>
      <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
