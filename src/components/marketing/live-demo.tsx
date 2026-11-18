"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  BookingChecklist,
  type BookingItem,
} from "@/components/app/screens/sales-agent/shared";
import {
  CalendarCheckIcon,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PauseCircleIcon,
  Play,
  RotateCcw,
  UserCheckIcon,
} from "@/components/icons";
import { AgentMark, AgentName } from "@/components/marketing/agent-mark";
import { BeamFrame } from "@/components/marketing/saas-frame";
import { QuotePreview, type QuoteView } from "@/components/sales/quote-preview";
import { Badge } from "@/components/ui/badge";
import { DEMO, EXAMPLE_LABEL } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

type Scenario = (typeof DEMO.scenarios)[number];
type Step = Scenario["steps"][number];
type Result = Extract<Step, { kind: "result" }>["result"];

const STEP_MS = 1900;
const REST_MS = 4200;
const TIMEZONE = "America/Chicago";
/** A fixed date, so the page renders the same on the server and in the browser. */
const VALID_UNTIL = Date.UTC(2026, 11, 2, 18);

/** The quote the demo sends, in the exact shape the product's own quote card reads. */
const EXAMPLE_QUOTE = {
  _id: "example",
  kind: "one_time",
  status: "sent",
  service: "Standard clean",
  scope: [
    "Kitchen counters and appliances wiped",
    "Bathrooms cleaned and sanitized",
    "Floors vacuumed and mopped",
    "Beds made, trash taken out",
  ],
  lines: [
    { label: "Base price", amountCents: 12000 },
    { label: "2 more bedrooms", amountCents: 4000 },
    { label: "1 more bathroom", amountCents: 2500 },
  ],
  first: null,
  firstNote: null,
  cadence: null,
  per: "visit",
  outcome: "price",
  visitCents: 18500,
  firstCents: null,
  totalCents: 18500,
  depositCents: null,
  terms: {
    payment: "Payment is due when the service is complete.",
    cancellation:
      "Tell us at least 24 hours before your appointment if you need to cancel or move it.",
  },
  agreementRequired: false,
  durationMinutes: 210,
  expiresAt: VALID_UNTIL,
  sentAt: null,
  acceptance: null,
  declined: null,
  question: null,
  hash: null,
  createdAt: VALID_UNTIL,
} as unknown as QuoteView;

const BOOKING_ITEMS = [
  {
    key: "details",
    label: "Required details",
    state: "done",
    detail: "214 Oak Street, Austin. Access is on record.",
    by: null,
  },
  {
    key: "quote",
    label: "Quote accepted",
    state: "done",
    detail: "Maria Lopez accepted $185.00.",
    by: null,
  },
  {
    key: "time",
    label: "Time and capacity",
    state: "done",
    detail: "Friday 9:00 AM to 12:30 PM. Capacity held.",
    by: null,
  },
  {
    key: "payment",
    label: "Payment",
    state: "not_required",
    detail: "Paid after the visit, as your Playbook says.",
    by: null,
  },
  {
    key: "confirmed",
    label: "Booking confirmed",
    state: "done",
    detail: "Handed to Dispatch to arrange the team.",
    by: null,
  },
] as unknown as BookingItem[];

function prefersStill() {
  return (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function ResultCard({ result }: { result: Result }) {
  if (result === "quote")
    return (
      <QuotePreview
        quote={EXAMPLE_QUOTE}
        company="Alpha Cleaning"
        timezone={TIMEZONE}
      />
    );
  if (result === "booking")
    return (
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-strong">
          <CalendarCheckIcon className="size-4 text-success" aria-hidden />
          Booked for Friday at 9:00 AM
        </p>
        <BookingChecklist items={BOOKING_ITEMS} />
      </div>
    );
  if (result === "ranking")
    return (
      <div className="grid gap-2 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-strong">
          Tomorrow 9:00 · needs a cleaner
        </p>
        {[
          {
            name: "Priya S.",
            detail: "Available · 6 miles · deep-clean cleared",
            state: "Offered",
            tone: "info" as const,
          },
          {
            name: "Maria R.",
            detail: "Finishes a job at 9:30 · 4 miles",
            state: "Next",
            tone: "outline" as const,
          },
          {
            name: "Sam W.",
            detail: "Not enough time between jobs",
            state: "Ruled out",
            tone: "outline" as const,
          },
        ].map((row) => (
          <div
            key={row.name}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-strong">
                {row.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {row.detail}
              </span>
            </span>
            <Badge variant={row.tone} size="sm">
              {row.state}
            </Badge>
          </div>
        ))}
      </div>
    );
  if (result === "coverage")
    return (
      <div className="grid gap-3 rounded-2xl border border-success/40 bg-success/10 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-strong">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          Covered: Priya S. accepted
        </p>
        <p className="text-sm text-muted-foreground">
          Standard clean · tomorrow 9:00 · 214 Oak Street. The customer’s visit
          is unchanged.
        </p>
      </div>
    );
  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-strong">
        <UserCheckIcon className="size-4 text-brand-300" aria-hidden />
        Dana K. · interview Tuesday 2:00 PM
      </p>
      <ul className="grid gap-1.5 text-sm">
        {[
          "Application received",
          "Meets your requirements",
          "Interview on the calendar",
        ].map((line) => (
          <li key={line} className="flex items-center gap-2 text-strong">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            {line}
          </li>
        ))}
        <li className="flex items-center gap-2 text-muted-foreground">
          <span
            className="size-4 rounded-full border border-dashed border-warning"
            aria-hidden
          />
          Your decision after the interview
        </li>
      </ul>
    </div>
  );
}

function Typing({ side }: { side: "in" | "out" }) {
  return (
    <li
      className={cn("flex", side === "out" ? "justify-end" : "justify-start")}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-2xl px-3.5 py-3",
          side === "out"
            ? "rounded-br-md bg-brand-500/10"
            : "rounded-bl-md border border-border bg-card",
        )}
      >
        <span className="sr-only">{DEMO.typing}</span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce"
            style={{ animationDelay: `${dot * 140}ms` }}
            aria-hidden
          />
        ))}
      </span>
    </li>
  );
}

/**
 * The scripted demo. It plays once it scrolls into view, can be paused, replayed or switched, and holds
 * every step on screen for anyone who asks for reduced motion. Panels have fixed heights, so playing it
 * never moves the page.
 */
export function LiveDemo() {
  const [active, setActive] = useState(0);
  const scenario = DEMO.scenarios[active];
  const steps: readonly Step[] = scenario.steps;
  const total: number = steps.length;
  const [shown, setShown] = useState<number>(total);
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLOListElement>(null);
  const log = useRef<HTMLOListElement>(null);

  const start = useCallback((index: number) => {
    setActive(index);
    if (prefersStill()) {
      setShown(DEMO.scenarios[index].steps.length);
      setPlaying(false);
      return;
    }
    setShown(0);
    setPlaying(true);
  }, []);

  // Play the first time the demo is on screen.
  useEffect(() => {
    const node = root.current;
    if (!node || prefersStill()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started.current || !entries.some((entry) => entry.isIntersecting))
          return;
        started.current = true;
        observer.disconnect();
        start(0);
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [start]);

  // One step at a time; when a scenario ends, rest, then play the next one.
  useEffect(() => {
    if (!playing) return;
    if (shown < total) {
      const timer = window.setTimeout(
        () => setShown((count) => count + 1),
        shown === 0 ? 500 : STEP_MS,
      );
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(
      () => start((active + 1) % DEMO.scenarios.length),
      REST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active, playing, shown, start, total]);

  // Keep the newest line in view inside each panel, without scrolling the page.
  useLayoutEffect(() => {
    for (const node of [thread.current, log.current])
      if (node) node.scrollTop = node.scrollHeight;
  }, [shown, active]);

  const visible = steps.slice(0, shown);
  const next: Step | undefined = playing ? steps[shown] : undefined;
  const messages = visible.filter(
    (step) => step.kind === "in" || step.kind === "out",
  );
  const work = visible.filter((step) => step.kind === "work");
  const results = visible.filter(
    (step): step is Extract<Step, { kind: "result" }> => step.kind === "result",
  );
  const latest = results.at(-1)?.result ?? null;

  return (
    <div ref={root} className="grid gap-4">
      <div
        role="tablist"
        aria-label="Examples"
        className="flex flex-wrap gap-2"
      >
        {DEMO.scenarios.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => {
              started.current = true;
              start(index);
            }}
            className={cn(
              "flex items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
              index === active
                ? "border-brand-500/60 bg-brand-500/10 text-strong"
                : "border-border bg-card text-muted-foreground hover:text-strong",
            )}
          >
            <AgentMark id={item.agent} size="sm" />
            {item.tab}
          </button>
        ))}
      </div>

      <BeamFrame glow className="p-0 sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <AgentMark id={scenario.agent} size="sm" live={playing} />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <AgentName id={scenario.agent} className="text-sm" />
                <Badge variant="outline" size="sm">
                  {EXAMPLE_LABEL}
                </Badge>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {scenario.summary}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                shown >= total ? start(active) : setPlaying((value) => !value)
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              {playing ? (
                <PauseCircleIcon className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
              {playing ? DEMO.pause : shown >= total ? DEMO.replay : DEMO.play}
            </button>
            {shown >= total ? null : (
              <button
                type="button"
                onClick={() => start(active)}
                aria-label={DEMO.replay}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div className="h-0.5 bg-border" aria-hidden>
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-brand-300 transition-[width] duration-500 ease-out"
            style={{ width: `${(shown / total) * 100}%` }}
          />
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section
            aria-label={DEMO.conversationTitle}
            className="border-b border-border p-4 sm:p-5 lg:border-r lg:border-b-0"
          >
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">
              <MessageSquareText className="size-3.5" aria-hidden />
              {DEMO.conversationTitle}
              <span className="font-normal tracking-normal text-muted-foreground normal-case">
                · {scenario.contact}
              </span>
            </p>
            <ol
              ref={thread}
              className="mt-3 grid h-[22rem] content-start gap-2.5 overflow-y-auto pr-1 sm:h-[26rem] lg:h-[36rem]"
              aria-live="polite"
            >
              {messages.map((step, index) => (
                <li
                  key={`${scenario.id}-m-${index}`}
                  className={cn(
                    "flex motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1",
                    step.kind === "out" ? "justify-end" : "justify-start",
                  )}
                >
                  <p
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed text-strong",
                      step.kind === "out"
                        ? "rounded-br-md bg-brand-500/10"
                        : "rounded-bl-md border border-border bg-card",
                    )}
                  >
                    {step.text}
                  </p>
                </li>
              ))}
              {next && (next.kind === "in" || next.kind === "out") ? (
                <Typing side={next.kind} />
              ) : null}
            </ol>
          </section>

          <div className="grid content-start">
            <section
              aria-label={DEMO.workTitle}
              className="border-b border-border p-4 sm:p-5"
            >
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">
                {DEMO.workTitle}
              </p>
              <ol
                ref={log}
                className="mt-3 grid h-40 content-start gap-2 overflow-y-auto pr-1"
              >
                {work.map((step, index) => (
                  <li
                    key={`${scenario.id}-w-${index}`}
                    className="flex items-start gap-2 text-sm leading-relaxed text-strong motion-safe:animate-in motion-safe:fade-in"
                  >
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-hidden
                    />
                    {step.text}
                  </li>
                ))}
                {next?.kind === "work" ? (
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2
                      className="size-4 shrink-0 animate-spin text-brand-300 motion-reduce:animate-none"
                      aria-hidden
                    />
                    {DEMO.waiting}
                  </li>
                ) : null}
              </ol>
            </section>
            <section aria-label={DEMO.resultTitle} className="p-4 sm:p-5">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">
                {DEMO.resultTitle}
              </p>
              <div className="mt-3 h-[19rem] overflow-y-auto pr-1 sm:h-[22rem]">
                {latest ? (
                  <div
                    key={`${scenario.id}-${latest}`}
                    className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
                  >
                    <ResultCard result={latest} />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                    {DEMO.waiting}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </BeamFrame>
    </div>
  );
}
