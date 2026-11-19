"use client";

/**
 * Company setup: four stages, one short decision at a time, with what Selestial knows so far beside it.
 * Every step is saved as the owner leaves it, so closing the tab, changing device or coming back next week
 * resumes in the same place. Nothing here switches an agent on or sends anything to anyone.
 */
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, messageOf, TextInput } from "@/components/app/form";
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Globe, Info, PenLine, Plug, Rocket, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LANDING_PATH } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { CATEGORY_CHOICES, SCALE_CHOICES, TOOL_CHOICES, WORKFORCE_CHOICES, type Choice } from "../../../../convex/lib/setup/facts";
import { connectionsFor, PRIORITY_INFO, QUESTIONS, STAGES, stepsFor, UNSURE } from "../../../../convex/lib/setup/path";
import { ActivationReview } from "@/components/app/activation/review";
import { ClientImport } from "./import";
import { PrepareDrafts, WebsiteProgress } from "./prepare";
import type { Method, Priority } from "../../../../convex/lib/setup/schema";

type View = FunctionReturnType<typeof api.setup.state>;
type Setup = NonNullable<View["setup"]>;
type Value = string | string[];

const one = (value: Value | undefined) => (typeof value === "string" ? value : "");
const many = (value: Value | undefined) => (Array.isArray(value) ? value : []);
const labelOf = (choices: Choice[], value: string) => choices.find((choice) => choice.value === value)?.label ?? value;
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

export function SetupScreen() {
  const { companyId } = useCompany();
  const view = useQuery(api.setup.state, { companyId });
  const begin = useMutation(api.setup.begin);
  const [version, setVersion] = useState(0);
  if (view === undefined) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-5xl content-start gap-4 p-6" aria-busy="true" aria-label="Loading your setup">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (!view.canEdit) return <Message title="Setup is the Owner's" body="Your company's Owner sets this up. You can start working in the workspace now." />;
  if (!view.setup) {
    return (
      <Message title="Your company is already working in Selestial" body="Setup is optional for you. Going through it lets you confirm what Selestial knows about your company and choose what it helps with first. Nothing you have is changed.">
        <Button variant="primary" onClick={() => void begin({ companyId })}>
          Go through setup
        </Button>
      </Message>
    );
  }
  return <Flow key={version} view={view} setup={view.setup} onReload={() => setVersion((value) => value + 1)} />;
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <main className="mx-auto grid min-h-dvh max-w-lg content-center gap-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold text-strong">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="flex justify-center gap-2">
        {children}
        <Button variant="outline" onClick={() => router.push(LANDING_PATH)}>
          Open workspace
        </Button>
      </div>
    </main>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────────────────────────────

function ChoiceCard({ choice, selected, onPress, multi }: { choice: Choice; selected: boolean; onPress: () => void; multi: boolean }) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onPress}
      className={cn(
        "flex min-h-14 items-start gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 motion-reduce:transition-none",
        selected ? "border-brand-500 bg-brand-500/8" : "border-border bg-card hover:border-brand-500/40",
      )}
    >
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center border", multi ? "rounded-md" : "rounded-full", selected ? "border-brand-500 bg-brand-500 text-white" : "border-border bg-background")} aria-hidden>
        {selected ? <Check className="size-3.5" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-strong">{choice.label}</span>
        {choice.hint ? <span className="block text-xs text-muted-foreground">{choice.hint}</span> : null}
      </span>
    </button>
  );
}

function Chips({ choices, value, onChange, label }: { choices: Choice[]; value: string[]; onChange: (next: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {choices.map((choice) => {
        const on = value.includes(choice.value);
        return (
          <button key={choice.value} type="button" aria-pressed={on} onClick={() => onChange(toggle(value, choice.value))} className={cn("min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 motion-reduce:transition-none", on ? "border-brand-500 bg-brand-500/8 text-strong" : "border-border bg-card text-foreground hover:border-brand-500/40")}>
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function StepHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <header className="grid gap-1.5">
      <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">{eyebrow}</p>
      <h1 className="font-display text-2xl font-semibold text-balance text-strong sm:text-3xl">{title}</h1>
      {lead ? <p className="text-sm text-muted-foreground">{lead}</p> : null}
    </header>
  );
}

// ── The flow ────────────────────────────────────────────────────────────────────────────────────────

const METHOD_CARDS: { id: Method; icon: typeof Globe; title: string; body: string }[] = [
  { id: "website", icon: Globe, title: "Use my website", body: "Give us the address. It is kept with your company details." },
  { id: "connect", icon: Plug, title: "Connect or upload information", body: "Bring in what you already have: a spreadsheet, a calendar, an inbox." },
  { id: "manual", icon: PenLine, title: "Enter details myself", body: "A few short questions. Most take one tap." },
];

function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

function Flow({ view, setup, onReload }: { view: View; setup: Setup; onReload: () => void }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const save = useMutation(api.setup.save);
  const startRead = useMutation(api.setupWebsite.start);
  const [useFound, setUseFound] = useState<string[]>([]);
  const enter = useMutation(api.setup.enter);
  const startAgents = useMutation(api.activation.start);

  const [revision, setRevision] = useState(setup.revision);
  const [stepId, setStepId] = useState(setup.step);
  const [methods, setMethods] = useState<Method[]>(setup.methods);
  const [priority, setPriority] = useState<Priority | null>(setup.priority);
  const [secondary, setSecondary] = useState<Priority[]>(setup.secondary);
  const [answers, setAnswers] = useState<Record<string, Value>>(setup.answers);
  const [name, setName] = useState(view.company.name);
  const [timezone, setTimezone] = useState(view.company.timezone);
  // Only what a person confirmed fills the fields. Anything found on a page is offered beside the field instead.
  const [facts, setFacts] = useState<Record<string, Value>>(() => Object.fromEntries(Object.entries(view.facts).filter(([, row]) => row.state === "confirmed").map(([key, row]) => [key, row.value])));
  const [state, setState] = useState<"saved" | "saving" | "failed">("saved");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const allZones = useMemo(() => zones(), []);

  const steps = stepsFor(priority ?? undefined, secondary);
  const index = Math.max(0, steps.findIndex((step) => step.id === stepId));
  const step = steps[index];
  const stage = step.stage;
  const question = step.id.startsWith("q:") ? QUESTIONS.find((item) => item.id === step.id.slice(2)) : undefined;
  const fact = (key: string, value: Value) => setFacts((current) => ({ ...current, [key]: value }));
  const info = PRIORITY_INFO.find((item) => item.id === priority);

  /** Saves this step's own fields and moves to `to`. Returns false, with the reason shown, if it was refused. */
  async function go(to: string, extra: { skip?: string; confirmContext?: boolean } = {}): Promise<boolean> {
    setState("saving");
    setError(null);
    try {
      if (step.id === "start" && methods.includes("website") && to !== step.id) await startRead({ companyId, url: one(facts["company.website"]) });
      type Own = { methods?: Method[]; priority?: Priority; secondary?: Priority[]; company?: { name: string; timezone: string }; facts?: Record<string, Value>; answers?: Record<string, Value> };
      const own: Own =
        step.id === "start"
          ? { methods, facts: { "company.website": methods.includes("website") ? one(facts["company.website"]) : "" } }
          : step.id === "basics"
            ? { company: { name, timezone }, facts: { "company.location": one(facts["company.location"]), "company.areas": one(facts["company.areas"]), "services.categories": many(facts["services.categories"]), ...Object.fromEntries(useFound.map((key) => [key, view.facts[key]?.value ?? ""])) } }
            : step.id === "team"
              ? { facts: { "workforce.arrangement": many(facts["workforce.arrangement"]), "scale.cleaners": one(facts["scale.cleaners"]), "tools.current": many(facts["tools.current"]), "tools.other": one(facts["tools.other"]) } }
              : step.id === "priority"
                ? { ...(priority ? { priority } : {}), secondary }
                : question && answers[question.id] !== undefined
                  ? { answers: { [question.id]: answers[question.id] } }
                  : {};
      const result = await save({ companyId, expectedRevision: revision, step: to, ...own, ...extra });
      setRevision(result.revision);
      setStepId(to);
      setState("saved");
      window.scrollTo({ top: 0 });
      return true;
    } catch (caught) {
      setState("failed");
      setError(messageOf(caught));
      return false;
    }
  }

  const blocked =
    step.id === "start"
      ? methods.length === 0
        ? "Choose at least one way to start."
        : methods.includes("website") && one(facts["company.website"]).trim() === ""
          ? "Enter your website address, or untick that option."
          : null
      : step.id === "basics"
        ? name.trim() === ""
          ? "Your company needs a name."
          : allZones.length > 0 && !allZones.includes(timezone)
            ? "Choose a time zone from the list."
            : null
        : step.id === "priority"
          ? priority
            ? null
            : "Choose what Selestial should help with first."
          : question && !question.optional && (answers[question.id] === undefined || (Array.isArray(answers[question.id]) && answers[question.id].length === 0))
            ? "Choose an answer, or say you are not sure."
            : null;

  const next = steps[index + 1];
  const previous = steps[index - 1];

  async function openWorkspace(confirmContext: boolean) {
    if (confirmContext && !(await go("review", { confirmContext: true }))) return;
    await enter({ companyId });
    router.push(LANDING_PATH);
  }

  /**
   * The Owner starts the work shown on the review step. The server plans and runs it in the background, so
   * leaving the page right after is fine; pressing it twice starts one batch. Save and exit never does this.
   */
  async function startMyAgents() {
    if (!(await go("review", { confirmContext: true }))) return;
    setState("saving");
    try {
      await startAgents({ companyId, source: "setup" });
      router.push(`${LANDING_PATH}#agents-working`);
    } catch (caught) {
      setState("failed");
      setError(messageOf(caught));
    }
  }

  const summary = <Summary name={name} timezone={timezone} facts={facts} priority={priority} secondary={secondary} agents={view.agents} postalCodes={view.company.postalCodes} />;

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <p className="font-display text-base font-semibold text-strong">Selestial</p>
          <ol className="ml-2 hidden items-center gap-1 md:flex" aria-label="Setup stages">
            {STAGES.map((item, at) => {
              const current = item.id === stage;
              const done = STAGES.findIndex((row) => row.id === stage) > at;
              return (
                <li key={item.id} aria-current={current ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", current ? "bg-brand-500/10 text-strong" : done ? "text-strong" : "text-muted-foreground")}>
                  <span className={cn("grid size-4 place-items-center rounded-full text-[10px]", done ? "bg-success text-white" : current ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground")} aria-hidden>
                    {done ? <Check className="size-3" /> : at + 1}
                  </span>
                  {item.label}
                </li>
              );
            })}
          </ol>
          <p className="ml-auto text-xs text-muted-foreground" role="status" aria-live="polite">
            {state === "saving" ? "Saving…" : state === "failed" ? "Not saved" : "Saved"}
          </p>
          <Button variant="ghost" size="sm" onClick={() => void (async () => ((await go(step.id)) ? openWorkspace(false) : undefined))()}>
            Save and exit
          </Button>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
          <p className="mb-1 text-xs text-muted-foreground md:hidden">
            {STAGES.find((item) => item.id === stage)?.label} · step {index + 1} of {steps.length}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label={`Step ${index + 1} of ${steps.length} on your path`}>
            <div className="h-full rounded-full bg-brand-500 transition-[width] motion-reduce:transition-none" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
      </header>

      <div className={cn("mx-auto grid w-full flex-1 gap-6 px-4 py-6 sm:px-6", step.id === "review" ? "max-w-3xl" : "max-w-6xl lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <main className="min-w-0">
          <div className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:p-7">
            {step.id === "start" ? (
              <>
                <StepHeading eyebrow="Your company" title="How would you like to start?" lead="Choose one or more. You can change your mind at any point, and nothing is used until you have seen it." />
                <div className="grid gap-2.5" role="group" aria-label="Ways to start">
                  {METHOD_CARDS.map((card) => {
                    const on = methods.includes(card.id);
                    return (
                      <div key={card.id} className={cn("rounded-xl border transition-colors motion-reduce:transition-none", on ? "border-brand-500 bg-brand-500/8" : "border-border bg-card")}>
                        <button type="button" role="checkbox" aria-checked={on} onClick={() => setMethods(toggle(methods, card.id) as Method[])} className="flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                          <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", on ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground")} aria-hidden>
                            <card.icon className="size-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium text-strong">{card.title}</span>
                            <span className="block text-sm text-muted-foreground">{card.body}</span>
                          </span>
                        </button>
                        {on && card.id === "website" ? (
                          <div className="px-3.5 pb-3.5">
                            <Field label="Website address">
                              <TextInput value={one(facts["company.website"])} onChange={(event) => fact("company.website", event.target.value)} placeholder="yourcompany.com" inputMode="url" autoComplete="url" maxLength={200} />
                            </Field>
                          </div>
                        ) : null}
                        {on && card.id === "connect" ? <p className="px-3.5 pb-3.5 text-xs text-muted-foreground">You will choose what to bring in after you pick a priority, so we only ask for what that needs.</p> : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {step.id === "basics" ? (
              <>
                <StepHeading eyebrow="Your company" title="The basics" lead="Only what every part of Selestial needs. Anything already known is filled in." />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name">
                    <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={160} autoComplete="organization" required />
                  </Field>
                  <div className="grid content-start gap-1.5">
                    <Field label="Where you are based" hint="City and state is enough.">
                      <TextInput value={one(facts["company.location"])} onChange={(event) => fact("company.location", event.target.value)} placeholder="Austin, TX" maxLength={120} />
                    </Field>
                    <Suggestion found={view.facts["company.location"]} current={facts["company.location"]} onUse={(value) => fact("company.location", value)} />
                  </div>
                  <Field label="Time zone" hint="Schedules, availability and deadlines are shown on this clock. Type to search.">
                    <TextInput value={timezone} onChange={(event) => setTimezone(event.target.value)} list="setup-zones" autoComplete="off" required />
                  </Field>
                  <div className="grid content-start gap-1.5">
                    <Field label="Areas you serve" hint="Cities or neighborhoods, in your own words.">
                      <TextInput value={one(facts["company.areas"])} onChange={(event) => fact("company.areas", event.target.value)} placeholder="Austin, Round Rock, Cedar Park" maxLength={300} />
                    </Field>
                    <Suggestion found={view.facts["company.areas"]} current={facts["company.areas"]} onUse={(value) => fact("company.areas", value)} />
                  </div>
                  <datalist id="setup-zones">
                    {allZones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                </div>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium text-strong">Who do you clean for?</legend>
                  <Suggestion found={view.facts["services.categories"]} current={facts["services.categories"]} onUse={(value) => fact("services.categories", value)} words={(value) => many(value).map((item) => labelOf(CATEGORY_CHOICES, item)).join(", ")} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CATEGORY_CHOICES.map((choice) => (
                      <ChoiceCard key={choice.value} choice={choice} multi selected={many(facts["services.categories"]).includes(choice.value)} onPress={() => fact("services.categories", toggle(many(facts["services.categories"]), choice.value))} />
                    ))}
                  </div>
                </fieldset>
                {(["contact.phone", "contact.email", "company.about", "policies.published"] as const).some((key) => view.facts[key]?.state === "found") ? (
                  <fieldset className="grid gap-2 rounded-xl border border-border p-3">
                    <legend className="px-1 text-sm font-medium text-strong">Also found on your website</legend>
                    <p className="text-xs text-muted-foreground">Tick what is right. Anything you leave unticked stays a suggestion and is not used.</p>
                    {(["contact.phone", "contact.email", "company.about", "policies.published"] as const)
                      .filter((key) => view.facts[key]?.state === "found")
                      .map((key) => (
                        <label key={key} className="flex items-start gap-2.5 text-sm">
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#6838ef]" checked={useFound.includes(key)} onChange={() => setUseFound(toggle(useFound, key))} />
                          <span className="min-w-0">
                            <span className="block text-xs text-muted-foreground">{FOUND_LABELS[key]}</span>
                            <span className="block break-words text-strong">{one(view.facts[key]?.value)}</span>
                          </span>
                        </label>
                      ))}
                  </fieldset>
                ) : null}
                <Why>These tailor the services, agreements and booking pages Selestial prepares. They do not publish or price anything.</Why>
              </>
            ) : null}

            {step.id === "team" ? (
              <>
                <StepHeading eyebrow="Your company" title="Your team and how you run today" lead="Optional. It helps Selestial suggest the right setup for your size." />
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium text-strong">How do your cleaners work with you?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {WORKFORCE_CHOICES.map((choice) => (
                      <ChoiceCard key={choice.value} choice={choice} multi selected={many(facts["workforce.arrangement"]).includes(choice.value)} onPress={() => fact("workforce.arrangement", toggle(many(facts["workforce.arrangement"]), choice.value))} />
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-strong">About how many people clean for you?</p>
                  <Chips label="People who clean" choices={SCALE_CHOICES} value={one(facts["scale.cleaners"]) ? [one(facts["scale.cleaners"])] : []} onChange={(nextValue) => fact("scale.cleaners", nextValue.find((value) => value !== one(facts["scale.cleaners"])) ?? "")} />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-strong">What do you run the business on today?</p>
                  <Chips label="Current tools" choices={TOOL_CHOICES} value={many(facts["tools.current"])} onChange={(nextValue) => fact("tools.current", nextValue)} />
                  <Field label="Anything else" hint="The name of an app or system you use, if you want to bring records from it later.">
                    <TextInput value={one(facts["tools.other"])} onChange={(event) => fact("tools.other", event.target.value)} maxLength={200} />
                  </Field>
                </div>
                <Why>Workers on payroll, contractors and subcontractor companies have different onboarding and pay rules in Selestial. We never ask for pay rates or bank details here.</Why>
              </>
            ) : null}

            {step.id === "priority" ? (
              <>
                <StepHeading eyebrow="Your priority" title="What would you like Selestial to help with first?" lead="Pick one to start with. The next questions follow from it, and you can add the others whenever you like." />
                <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="First priority">
                  {PRIORITY_INFO.map((item) => {
                    const first = priority === item.id;
                    const also = secondary.includes(item.id);
                    return (
                      <div key={item.id} className={cn("flex flex-col rounded-xl border transition-colors motion-reduce:transition-none", first ? "border-brand-500 bg-brand-500/8" : also ? "border-brand-500/40 bg-card" : "border-border bg-card")}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={first}
                          onClick={() => {
                            setPriority(item.id);
                            setSecondary(secondary.filter((value) => value !== item.id));
                          }}
                          className="flex flex-1 items-start gap-3 rounded-xl px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500"
                        >
                          <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border", first ? "border-brand-500 bg-brand-500 text-white" : "border-border bg-background")} aria-hidden>
                            {first ? <Check className="size-3.5" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium text-strong">{item.title}</span>
                            {item.caveat ? <span className="mt-1 block text-xs text-muted-foreground">{item.caveat}</span> : null}
                          </span>
                        </button>
                        {priority && !first ? (
                          <label className="flex items-center gap-2 border-t border-border/70 px-3.5 py-2 text-xs text-muted-foreground">
                            <input type="checkbox" className="size-4 shrink-0 accent-[#6838ef]" checked={also} onChange={() => setSecondary(toggle(secondary, item.id) as Priority[])} />
                            Also important to me
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {info ? (
                  <p className="flex gap-2 rounded-xl border border-brand-500/30 bg-brand-500/8 px-3.5 py-3 text-sm text-strong" role="status">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                    {info.first}
                  </p>
                ) : null}
              </>
            ) : null}

            {question ? (
              <>
                <StepHeading eyebrow={info ? info.title : "Your priority"} title={question.title} lead={question.kind === "multi" ? "Choose all that apply." : undefined} />
                <div className="grid gap-2 sm:grid-cols-2" role={question.kind === "multi" ? "group" : "radiogroup"} aria-label={question.title}>
                  {question.choices.map((choice) => {
                    const current = answers[question.id];
                    const selected = question.kind === "multi" ? many(current).includes(choice.value) : current === choice.value;
                    return <ChoiceCard key={choice.value} choice={choice} multi={question.kind === "multi"} selected={selected} onPress={() => setAnswers({ ...answers, [question.id]: question.kind === "multi" ? toggle(many(current), choice.value) : choice.value })} />;
                  })}
                  <ChoiceCard choice={{ value: UNSURE, label: "I'm not sure", hint: "We will mark it as open and come back to it." }} multi={false} selected={answers[question.id] === UNSURE} onPress={() => setAnswers({ ...answers, [question.id]: UNSURE })} />
                </div>
                <details className="group rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-strong">
                    <CircleHelp className="size-4 text-muted-foreground" aria-hidden />
                    Why we ask, and help deciding
                    <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  <p className="mt-2 text-muted-foreground">{question.why}</p>
                  <p className="mt-2 text-muted-foreground">If more than one fits, pick the one that is true most often. Nothing is locked in: you can change this later in the workspace.</p>
                </details>
              </>
            ) : null}

            {step.id === "records" ? (
              <>
                <StepHeading eyebrow="Prepare your workspace" title="Bring in what you already have" lead="Optional. Anything you bring in now saves you typing it later. Nothing is contacted because it was imported." />
                <section className="grid gap-2" aria-labelledby="clients-heading">
                  <h2 id="clients-heading" className="text-sm font-semibold text-strong">
                    Your clients
                  </h2>
                  <ClientImport />
                  <p className="text-xs text-muted-foreground">Using Jobber or Housecall Pro? A direct connection is coming next. Until then, export your client list from it and choose the file here.</p>
                </section>
                {connectionsFor(priority ?? undefined, secondary).length ? (
                  <section className="grid gap-2" aria-labelledby="connect-heading">
                    <h2 id="connect-heading" className="text-sm font-semibold text-strong">
                      Connections that help with this
                    </h2>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {connectionsFor(priority ?? undefined, secondary).map((connection) => (
                        <li key={connection.id}>
                          <a href={connection.href} target="_blank" rel="noreferrer" className="flex h-full flex-col gap-0.5 rounded-xl border border-border px-3.5 py-3 text-sm hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
                            <span className="font-medium text-strong">{connection.title}</span>
                            <span className="text-muted-foreground">{connection.does}</span>
                            <span className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-300">Set up in a new tab</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">None of these is required. You can continue without any of them.</p>
                  </section>
                ) : null}
              </>
            ) : null}

            {step.id === "prepare" ? (
              <>
                <StepHeading eyebrow="Prepare your workspace" title="Your first drafts, and what your team needs" lead="Drafts are prepared for you to review; nothing is published or sent. Each agent's readiness is read from your company's record right now, not from whether setup is finished." />
                {info ? (
                  <p className="flex gap-2 rounded-xl border border-brand-500/30 bg-brand-500/8 px-3.5 py-3 text-sm text-strong">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                    <span>
                      <span className="font-medium">Your first priority: {info.title.toLowerCase()}.</span> {info.first}
                    </span>
                  </p>
                ) : null}
                <PrepareDrafts priority={priority} secondary={secondary} categories={many(facts["services.categories"])} prepared={view.prepared} />
                <h2 className="text-sm font-semibold text-strong">Where each part of your team stands</h2>
                <ul className="grid gap-2.5">
                  {[...view.agents].sort((a, b) => Number(b.agent === info?.agent) - Number(a.agent === info?.agent)).map((agent) => (
                    <li key={agent.agent} className="rounded-xl border border-border p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-strong">{agent.name}</p>
                        <AgentBadge state={agent.state} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{agent.words}</p>
                      {agent.gaps.length > 0 ? (
                        <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          {agent.gaps.map((gap) => (
                            <li key={gap.words} className="flex gap-1.5">
                              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                              <span>
                                <span className="font-medium text-strong">Next: {gap.next}.</span> {gap.words}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Why>You do not need to finish any of this now. Each next step is waiting on the page it belongs to once you open your workspace.</Why>
              </>
            ) : null}

            {step.id === "review" ? (
              <>
                <StepHeading eyebrow="Review & start" title="Is this right?" lead="This is what Selestial will use across your workspace. You can correct any of it now or later." />
                {summary}
                <div className="flex flex-wrap gap-2 text-sm">
                  {(["basics", "team", "priority"] as const).map((id) => (
                    <Button key={id} variant="outline" size="sm" onClick={() => void go(id)}>
                      <PenLine aria-hidden />
                      Edit {id === "basics" ? "company details" : id === "team" ? "team" : "priority"}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-1 border-t border-border pt-4">
                  <h2 className="font-display text-lg font-semibold text-strong">What Selestial will start</h2>
                  <p className="text-sm text-muted-foreground">Selestial will begin the work shown below. You can leave this page—we’ll notify you when results are ready.</p>
                </div>
                <ActivationReview focus={priority} secondary={secondary} />
                <Why>Save and exit opens your workspace without starting anything, and switches nothing on. Starting your agents runs only the work above, within the permissions you set.</Why>
              </>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-strong" role="alert">
                <p>{error}</p>
                {error.includes("somewhere else") ? (
                  <Button variant="outline" size="sm" className="mt-2" onClick={onReload}>
                    Load the latest
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <details className={cn("mt-4 rounded-2xl border border-border bg-card lg:hidden", step.id === "review" && "hidden")} open={previewOpen} onToggle={(event) => setPreviewOpen((event.target as HTMLDetailsElement).open)}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-strong">
              <Sparkles className="size-4 text-brand-600" aria-hidden />
              What Selestial knows so far
              <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform motion-reduce:transition-none", previewOpen && "rotate-180")} aria-hidden />
            </summary>
            <div className="border-t border-border p-4">{summary}</div>
          </details>
        </main>

        <aside className={cn("hidden", step.id !== "review" && "lg:block")} aria-label="What Selestial knows so far">
          <div className="sticky top-6 rounded-2xl border border-border bg-card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
              <Sparkles className="size-4 text-brand-600" aria-hidden />
              What Selestial knows so far
            </p>
            {summary}
          </div>
        </aside>
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          {previous ? (
            <Button variant="ghost" onClick={() => void go(previous.id)} disabled={state === "saving"}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
          ) : null}
          <p className="min-w-0 flex-1 text-right text-xs text-muted-foreground" aria-live="polite">
            {blocked ?? ""}
          </p>
          {step.optional && next ? (
            <Button variant="outline" onClick={() => void go(next.id, { skip: step.id })} disabled={state === "saving"}>
              Skip for now
            </Button>
          ) : null}
          {next ? (
            <Button variant="primary" size="lg" onClick={() => void go(next.id)} disabled={Boolean(blocked) || state === "saving"} loading={state === "saving"}>
              Continue
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <>
              <Button variant="outline" size="lg" onClick={() => void openWorkspace(true)} disabled={state === "saving"}>
                Save and exit
              </Button>
              <Button variant="primary" size="lg" onClick={() => void startMyAgents()} disabled={state === "saving" || !priority} loading={state === "saving"}>
                <Rocket aria-hidden />
                Start my agents
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

const FOUND_LABELS = { "contact.phone": "Phone", "contact.email": "Email", "company.about": "How you describe the company", "policies.published": "A policy, in your website's words" } as const;

/** A value found on the owner's website, offered beside the field. It is used only if they choose it. */
function Suggestion({ found, current, onUse, words }: { found: View["facts"][string] | undefined; current: Value | undefined; onUse: (value: Value) => void; words?: (value: Value) => string }) {
  const show = (value: Value) => (words ? words(value) : one(value));
  const offer = found?.conflict && found.conflict.source === "website" ? found.conflict.value : found && found.source === "website" && found.state === "found" ? found.value : null;
  if (!offer || JSON.stringify(offer) === JSON.stringify(current)) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-xs text-strong">
      <Globe className="size-3.5 text-brand-600" aria-hidden />
      <span className="min-w-0">
        {found?.conflict ? "Your website says" : "Found on your website"}: <span className="font-medium">{show(offer)}</span>
      </span>
      <button type="button" className="font-medium text-brand-700 underline underline-offset-4 dark:text-brand-300" onClick={() => onUse(offer)}>
        Use this
      </button>
    </p>
  );
}

const AGENT_TONE = { ready_to_work: "success", waiting_for_information: "warning", connection_needed: "info", plan_needed: "info", paused: "outline", not_available: "outline" } as const;
const AGENT_WORDS = { ready_to_work: "Ready to work", waiting_for_information: "Waiting for information", connection_needed: "Connection needed", plan_needed: "Plan needed", paused: "Paused", not_available: "Not available yet" } as const;

function AgentBadge({ state }: { state: View["agents"][number]["state"] }) {
  return <Badge variant={AGENT_TONE[state]}>{AGENT_WORDS[state]}</Badge>;
}

/** What is known, in the owner's words as they type it. Nothing here is a guess: an empty line says "Not given yet". */
function Summary({ name, timezone, facts, priority, secondary, agents, postalCodes }: { name: string; timezone: string; facts: Record<string, Value>; priority: Priority | null; secondary: Priority[]; agents: View["agents"]; postalCodes: string[] }) {
  const rows: [string, string][] = [
    ["Company", name.trim()],
    ["Based in", one(facts["company.location"])],
    ["Time zone", timezone],
    ["Serves", [one(facts["company.areas"]), postalCodes.length ? `booking limited to ${postalCodes.length} postal ${postalCodes.length === 1 ? "code" : "codes"}` : ""].filter(Boolean).join("; ")],
    ["Cleans for", many(facts["services.categories"]).map((value) => labelOf(CATEGORY_CHOICES, value)).join(", ")],
    ["Cleaners", [many(facts["workforce.arrangement"]).map((value) => labelOf(WORKFORCE_CHOICES, value)).join(", "), one(facts["scale.cleaners"]) ? `${labelOf(SCALE_CHOICES, one(facts["scale.cleaners"]))} people` : ""].filter(Boolean).join(" · ")],
    ["Uses today", [...many(facts["tools.current"]).map((value) => labelOf(TOOL_CHOICES, value)), one(facts["tools.other"])].filter(Boolean).join(", ")],
    ["Website", one(facts["company.website"])],
  ];
  const first = PRIORITY_INFO.find((item) => item.id === priority);
  return (
    <div className="grid gap-4">
      <WebsiteProgress />
      <dl className="grid gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("min-w-0 break-words", value ? "text-strong" : "text-muted-foreground/70")}>{value || "Not given yet"}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
        <p className="text-xs font-medium text-muted-foreground">First priority</p>
        <p className="text-strong">{first ? first.title : "Not chosen yet"}</p>
        {secondary.length ? <p className="mt-0.5 text-xs text-muted-foreground">Also: {secondary.map((value) => PRIORITY_INFO.find((item) => item.id === value)?.title.toLowerCase()).join("; ")}</p> : null}
      </div>
      <ul className="grid gap-1.5 text-sm" aria-label="Your team's readiness">
        {agents.map((agent) => (
          <li key={agent.agent} className="flex items-center justify-between gap-2">
            <span className="text-strong">{agent.name}</span>
            <AgentBadge state={agent.state} />
          </li>
        ))}
      </ul>
    </div>
  );
}
