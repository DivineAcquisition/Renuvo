"use client";

/**
 * The customer's page for a retention link: give feedback, describe an issue, review a proposed remedy,
 * say whether a correction worked, or manage a recurring service. It always shows whose page it is and
 * which property and service it is about.
 *
 * Opening the page does nothing. Every change is a button the customer presses after reading what it
 * does; a plan change shows its consequences first and is confirmed as a second step. Cancelling is
 * listed with the other choices, never behind them.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { Action, Card, Loading, Notice, Page, Problem, problemWords, Row, TextBox } from "@/components/cleaner/shell";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Checkbox, ChoiceChips, RadioButtonGroup } from "@/components/ui/selection";

type View = NonNullable<FunctionReturnType<typeof api.retentionCare.view>>;
type Active = Extract<View, { state: "active"; customerName: string }>;
type Result = { ok: true; words: string } | { ok: false; why: string };

const AREAS = ["Kitchen", "Bathroom", "Shower", "Floors", "Bedroom", "Dusting", "Trash", "Linens", "Supplies", "Access"];
const key = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function useAct() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function act(work: () => Promise<Result>) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (result.ok) setDone(result.words);
      else setProblem(result.why);
    } catch (caught) {
      setProblem(problemWords(caught));
    } finally {
      setBusy(false);
    }
  }
  return { busy, problem, done, act, setProblem };
}

function About({ view }: { view: Active }) {
  if (!view.property && !view.service) return null;
  return (
    <Card title="This is about">
      {view.property ? <Row label="Property">{view.property.name}{view.property.city ? `, ${view.property.city}` : ""}</Row> : null}
      {view.service ? <Row label="Service">{view.service.name}</Row> : null}
      {view.service ? <Row label="When">{view.service.when}</Row> : null}
    </Card>
  );
}

function AreaPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Where? Choose any that apply</legend>
      <ChoiceChips aria-label="Where" options={AREAS.map((area) => ({ value: area, label: area }))} value={value} onValueChange={onChange} />
    </fieldset>
  );
}

/** The public review page, shown the same to everyone who gave feedback, whatever they said. */
function ReviewInvite({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <Card title="Leave a public review">
      <p className="text-sm text-muted-foreground">If you would like to share your experience publicly, you can do that here. It is up to you.</p>
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border px-4 text-base font-semibold">
        Open the review page
      </a>
    </Card>
  );
}

function Feedback({ token, view }: { token: string; view: Active }) {
  const submit = useMutation(api.retentionCare.submitFeedback);
  const describe = useMutation(api.retentionCare.describeIssue);
  const [clientKey] = useState(key);
  const { busy, problem, done, act } = useAct();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [issue, setIssue] = useState(view.purpose === "issue");
  const [description, setDescription] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [cleaner, setCleaner] = useState(false);
  if (done || view.feedback?.submitted) {
    return (
      <>
        <Notice tone="good" title={done ?? "We already have your feedback. Thank you."} testId="state-submitted">
          {view.feedback?.describedIssue || issue ? "Someone will follow up with you about what you described." : null}
        </Notice>
        <ReviewInvite url={view.reviewUrl} />
      </>
    );
  }
  const send = () =>
    act(() => {
      const payload = { description, areas, wantsDifferentCleaner: cleaner };
      if (view.purpose === "issue") return describe({ token, issue: payload, clientKey });
      return submit({ token, clientKey, ...(rating !== null ? { rating } : {}), ...(comment.trim() ? { comment } : {}), ...(issue ? { issue: payload } : {}) });
    });
  return (
    <>
      {view.purpose === "feedback" ? (
        <Card title="How did it go?">
          <RadioButtonGroup aria-label="Rating from 1 to 5" className="flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={rating === value} onClick={() => setRating(value)} className={cn("flex min-h-12 flex-1 items-center justify-center rounded-xl border text-base font-semibold", rating === value ? "border-brand-500 bg-brand-500/15 text-strong" : "border-border bg-card")}>
                {value}
              </button>
            ))}
          </RadioButtonGroup>
          <p className="flex justify-between text-xs text-muted-foreground">
            <span>1 is poor</span>
            <span>5 is excellent</span>
          </p>
          <TextBox label="Anything you would like us to know (optional)" value={comment} onChange={setComment} />
          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <Checkbox className="mt-1" checked={issue} onCheckedChange={(checked) => setIssue(checked)} />
            <span>
              <span className="font-medium">Something was not right</span>
              <span className="block text-muted-foreground">Tell us and we will follow it up, whatever rating you gave.</span>
            </span>
          </label>
        </Card>
      ) : null}
      {issue ? (
        <Card title="What was not right?">
          <AreaPicker value={areas} onChange={setAreas} />
          <TextBox label="Describe it in your own words" value={description} onChange={setDescription} placeholder="For example: the shower was not cleaned." />
          {view.allowed.includes("request_different_cleaner") ? (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox className="mt-1" checked={cleaner} onCheckedChange={(checked) => setCleaner(checked)} />
              <span>I would like a different cleaner next time.</span>
            </label>
          ) : null}
        </Card>
      ) : null}
      <Problem message={problem} />
      <Action busy={busy} disabled={view.purpose === "issue" ? !description.trim() : issue ? !description.trim() : rating === null && !comment.trim()} onPress={() => void send()} testId="submit">
        Send
      </Action>
      <ReviewInvite url={view.reviewUrl} />
    </>
  );
}

function Remedy({ token, view }: { token: string; view: Active }) {
  const answer = useMutation(api.retentionCare.answerRemedy);
  const { busy, problem, done, act } = useAct();
  const [note, setNote] = useState("");
  const remedy = view.remedy;
  if (!remedy) return <Notice tone="neutral" title="There is nothing to review on this link right now" />;
  if (done) return <Notice tone="good" title={done} testId="state-answered" />;
  if (remedy.booked) return <Notice tone="good" title="This is arranged">{remedy.when ? `Your visit is ${remedy.when}.` : null}</Notice>;
  if (remedy.answered === "accepted") return <Notice tone="good" title="We have your yes">The office is confirming it and will be in touch with the details.</Notice>;
  if (remedy.answered === "declined") return <Notice tone="neutral" title="We have your answer">Someone will be in touch about another way to put it right.</Notice>;
  if (!remedy.open) return <Notice tone="neutral" title="This is no longer open">Contact the company if you still need help.</Notice>;
  return (
    <>
      <Card title="What we would like to do">
        <Row label="What">{remedy.what}</Row>
        <Row label="For">{remedy.about}</Row>
        {remedy.when ? <Row label="When">{remedy.when}</Row> : null}
        {remedy.minutes ? <Row label="About">{remedy.minutes} minutes</Row> : null}
        {remedy.charge ? <Row label="Cost to you">{remedy.charge}</Row> : null}
        <p className="text-sm text-muted-foreground">Nothing is booked until you say yes.</p>
      </Card>
      <TextBox label="A question, or anything we should know (optional)" value={note} onChange={setNote} />
      <Problem message={problem} />
      <Action busy={busy} onPress={() => void act(() => answer({ token, answer: "accept", ...(note.trim() ? { note } : {}) }))} testId="accept">
        Yes, that works
      </Action>
      <Action kind="secondary" busy={busy} disabled={!note.trim()} onPress={() => void act(() => answer({ token, answer: "ask", note }))} testId="ask">
        Ask a question first
      </Action>
      <Action kind="secondary" busy={busy} onPress={() => void act(() => answer({ token, answer: "decline", ...(note.trim() ? { note } : {}) }))} testId="decline">
        No, that does not work for me
      </Action>
    </>
  );
}

function Confirm({ token, view }: { token: string; view: Active }) {
  const confirm = useMutation(api.retentionCare.confirmCorrection);
  const { busy, problem, done, act } = useAct();
  const [note, setNote] = useState("");
  const state = view.confirm;
  if (done) return <Notice tone="good" title={done} testId="state-answered" />;
  if (state?.answered) return <Notice tone="good" title="We have your answer. Thank you.">{state.answered === "not_resolved" ? "Someone will follow up with you." : null}</Notice>;
  if (state?.closed) return <Notice tone="neutral" title="This was closed">Contact the company if something is still not right.</Notice>;
  return (
    <>
      <Card title="Did we put it right?">
        <p className="text-sm text-muted-foreground">We came back to take care of {state?.about ?? "what you reported"}. Please tell us honestly whether that solved it.</p>
        <TextBox label="Anything to add (optional)" value={note} onChange={setNote} />
      </Card>
      <Problem message={problem} />
      <Action busy={busy} onPress={() => void act(() => confirm({ token, answer: "resolved", ...(note.trim() ? { note } : {}) }))} testId="resolved">
        Yes, it is put right
      </Action>
      <Action kind="secondary" busy={busy} onPress={() => void act(() => confirm({ token, answer: "not_resolved", ...(note.trim() ? { note } : {}) }))} testId="not-resolved">
        No, it is still not right
      </Action>
    </>
  );
}

type ChangeId = NonNullable<Active["manage"]>["changes"][number]["id"];
const TOPIC: Record<string, string> = { bookings: "Your booked visits", future: "Future dates", billing: "Billing", credits: "Credits" };

function ConfirmChange({ token, change, words, needsZip, onBack, onDone }: { token: string; change: ChangeId; words: string; needsZip: boolean; onBack: () => void; onDone: (words: string) => void }) {
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [cadence, setCadence] = useState("");
  const [preferred, setPreferred] = useState("");
  const [reason, setReason] = useState("");
  const [zip, setZip] = useState("");
  const preview = useQuery(api.retentionCare.planPreview, { token, change, ...(from ? { from } : {}), ...(until ? { until } : {}), ...(cadence ? { cadence } : {}) });
  const request = useMutation(api.retentionCare.requestChange);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const date = "min-h-12 w-full rounded-xl border border-border bg-card px-3 text-base";
  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await request({ token, change, shown: preview.shown as Id<"jobs">[], confirmed: true, ...(from ? { from } : {}), ...(until ? { until } : {}), ...(cadence ? { cadence } : {}), ...(preferred ? { preferred } : {}), ...(reason ? { reason } : {}), ...(needsZip ? { zip } : {}) });
      if (result.ok) onDone(result.words);
      else setProblem(result.why);
    } catch (caught) {
      setProblem(problemWords(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title={words}>
        {change === "pause_service" || change === "end_service" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{change === "end_service" ? "End on (leave empty for today)" : "Pause from (leave empty for today)"}</span>
            <input type="date" className={date} value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
        ) : null}
        {change === "pause_service" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Start again on (leave empty to pause until you resume)</span>
            <input type="date" className={date} value={until} onChange={(event) => setUntil(event.target.value)} />
          </label>
        ) : null}
        {change === "change_cadence" ? <TextBox label="How often would you like service?" value={cadence} onChange={setCadence} placeholder="For example: every 2 weeks" /> : null}
        {change === "reschedule_visit" ? <TextBox label="When would suit you better?" value={preferred} onChange={setPreferred} placeholder="For example: any afternoon next week" /> : null}
        <TextBox label={change === "end_service" ? "Would you tell us why? (optional)" : "Anything we should know (optional)"} value={reason} onChange={setReason} />
      </Card>
      <Card title="What this does">
        {preview === undefined ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : preview === null ? (
          <p className="text-sm text-muted-foreground">This is not available on this link.</p>
        ) : preview.blocked ? (
          <p className="text-sm font-medium">{preview.blocked}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-3">
              {preview.consequences.map((line) => (
                <div key={line.topic}>
                  <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{TOPIC[line.topic]}</dt>
                  <dd className={cn("text-sm", line.topic === "billing" ? "font-medium" : "")}>{line.text}</dd>
                </div>
              ))}
            </dl>
            {preview.visits.length ? (
              <ul className="flex list-disc flex-col gap-1 border-t border-border pt-3 pl-5 text-sm">
                {preview.visits.map((visit) => (
                  <li key={visit.jobId}>{visit.when}</li>
                ))}
              </ul>
            ) : null}
            {preview.needsPerson ? <p className="text-sm text-muted-foreground">This is sent to the office as a request. Nothing changes until they confirm it with you.</p> : null}
          </>
        )}
      </Card>
      {needsZip ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">ZIP code of the service address</span>
          <span className="text-muted-foreground">We ask so that only you can make this change.</span>
          <input inputMode="numeric" autoComplete="postal-code" className={date} value={zip} onChange={(event) => setZip(event.target.value)} data-testid="zip" />
        </label>
      ) : null}
      <Problem message={problem} />
      <Action kind={change === "end_service" ? "danger" : "primary"} busy={busy} disabled={!preview || preview.blocked !== null || (needsZip && !zip.trim()) || (change === "change_cadence" && !cadence.trim())} onPress={() => void send()} testId="confirm-change">
        Confirm: {words.toLowerCase()}
      </Action>
      <Action kind="secondary" onPress={onBack}>
        Go back without changing anything
      </Action>
    </>
  );
}

function Manage({ token, view }: { token: string; view: Active }) {
  const askCleaner = useMutation(api.retentionCare.requestCleaner);
  const [choosing, setChoosing] = useState<{ id: ChangeId; words: string; needsZip: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const cleaner = useAct();
  const manage = view.manage;
  if (!manage) return <Notice tone="neutral" title="This service was not found">Contact the company and they will help.</Notice>;
  if (choosing) return <ConfirmChange token={token} change={choosing.id} words={choosing.words} needsZip={choosing.needsZip} onBack={() => setChoosing(null)} onDone={(words) => (setDone(words), setChoosing(null))} />;
  return (
    <>
      {done ? <Notice tone="good" title={done} testId="state-done" /> : null}
      <Card title="Your service">
        <Row label="How often">{manage.cadence}</Row>
        <Row label="Status">{manage.service}</Row>
      </Card>
      <Card title="Upcoming visits">
        {manage.visits.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {manage.visits.map((visit) => (
              <li key={visit.jobId}>{visit.when}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No visit is booked right now.</p>
        )}
      </Card>
      {manage.changes.length ? (
        <Card title="Make a change">
          <p className="text-sm text-muted-foreground">Choose one to see exactly what it does. Nothing changes until you confirm on the next step.</p>
          <div className="flex flex-col gap-2">
            {manage.changes.map((change) => (
              <button key={change.id} type="button" onClick={() => setChoosing(change)} data-testid={`change-${change.id}`} className="flex min-h-12 items-center justify-between rounded-xl border border-border bg-card px-4 text-left text-base font-medium">
                {change.words}
                <span aria-hidden className="text-muted-foreground">›</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}
      {manage.canAskForCleaner ? (
        <Card title="Ask for a different cleaner">
          {cleaner.done ? (
            <p className="text-sm font-medium">{cleaner.done}</p>
          ) : (
            <>
              <TextBox label="Tell us a little about why" value={note} onChange={setNote} />
              <Problem message={cleaner.problem} />
              <Action kind="secondary" busy={cleaner.busy} disabled={note.trim().length < 3} onPress={() => void cleaner.act(() => askCleaner({ token, note }))}>
                Send the request
              </Action>
            </>
          )}
        </Card>
      ) : null}
      {manage.requests.length ? (
        <Card title="Your recent requests">
          <ul className="flex flex-col gap-2 text-sm">
            {manage.requests.map((request) => (
              <li key={request.at} className="flex flex-col">
                <span className="font-medium">{request.title}</span>
                <span className="text-muted-foreground">{request.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

const TITLES: Record<View["purpose"], string> = { feedback: "How was your service?", issue: "Tell us what happened", remedy: "How we would like to put it right", confirm: "Did we put it right?", manage: "Your recurring service" };

export function CarePage({ token }: { token: string }) {
  const view = useQuery(api.retentionCare.view, { token });
  if (view === undefined) return <Loading what="your page" />;
  if (view === null) {
    return (
      <Page company={null} title="Link not found">
        <Notice tone="bad" title="This link doesn't work" testId="state-invalid">
          Check the link in your message, or ask the company to send a new one.
        </Notice>
      </Page>
    );
  }
  if (!("customerName" in view)) {
    return (
      <Page company={view.company.name} title={view.state === "expired" ? "This link has expired" : "This link is no longer active"}>
        <Notice tone="warn" title={view.state === "expired" ? "This link has expired" : "This link was closed"} testId={`state-${view.state}`}>
          Nothing was changed. Ask {view.company.name} for a new link{view.company.phone ? `, or call ${view.company.phone}` : ""}.
        </Notice>
      </Page>
    );
  }
  return (
    <Page company={view.company.name} title={TITLES[view.purpose]}>
      <p className="text-sm text-muted-foreground">Hi {view.customerName}. This page is private to you.</p>
      <About view={view} />
      {view.purpose === "feedback" || view.purpose === "issue" ? <Feedback token={token} view={view} /> : view.purpose === "remedy" ? <Remedy token={token} view={view} /> : view.purpose === "confirm" ? <Confirm token={token} view={view} /> : <Manage token={token} view={view} />}
      <p className="text-center text-xs text-muted-foreground">
        Questions? {view.company.phone ? `Call ${view.company.name} on ${view.company.phone}.` : view.company.email ? `Email ${view.company.email}.` : `Contact ${view.company.name}.`}
      </p>
    </Page>
  );
}
