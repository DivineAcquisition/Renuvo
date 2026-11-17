"use client";

import { useMutation, useQuery } from "convex/react";
import { Component, useCallback, useState, useSyncExternalStore, type ReactNode } from "react";

import { Action, Card, linkKey, Loading, Notice, Page, Problem, problemWords, TextBox } from "@/components/cleaner/shell";
import { useNow } from "@/components/app/use-now";
import { zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// ── The session on this phone ────────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
function sessionKey(token: string) {
  return `selestial.portal.${linkKey(token)}`;
}
function readSession(token: string): string | null {
  try {
    return window.localStorage.getItem(sessionKey(token));
  } catch {
    return null;
  }
}
function writeSession(token: string, session: string | null) {
  try {
    if (session) window.localStorage.setItem(sessionKey(token), session);
    else window.localStorage.removeItem(sessionKey(token));
  } catch {
    // Private mode: the session lasts as long as the page.
  }
  listeners.forEach((listener) => listener());
}
function useSession(token: string): [string | null, (session: string | null) => void] {
  const [memory, setMemory] = useState<string | null>(null);
  const stored = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readSession(token),
    () => null,
  );
  const set = useCallback(
    (session: string | null) => {
      setMemory(session);
      writeSession(token, session);
    },
    [token],
  );
  return [stored ?? memory, set];
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function useRun() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setProblem(null);
    try {
      return await work();
    } catch (error) {
      setProblem(problemWords(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, setProblem, run };
}

// ── Confirming it is them ────────────────────────────────────────────────────────────────────────

function CodeEntry({ onConfirm, onSend, sentTo, busy, problem }: { onConfirm: (code: string) => void; onSend: () => void; sentTo: string | null; busy: boolean; problem: string | null }) {
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">The 6-digit code we texted{sentTo ? ` to ${sentTo}` : ""}</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          className="h-14 w-full rounded-xl border border-border bg-background px-4 text-center text-2xl font-semibold tracking-[0.4em] outline-none focus:border-brand-500"
          aria-describedby="code-help"
          data-testid="code"
        />
        <span id="code-help" className="text-xs text-muted-foreground">
          The code works for 10 minutes. Nobody from the office will ask you for it.
        </span>
      </label>
      <Problem message={problem} />
      <Action busy={busy} disabled={code.length !== 6} onPress={() => onConfirm(code)} testId="confirm-code">
        Confirm
      </Action>
      <button type="button" onClick={onSend} className="min-h-11 text-sm font-medium text-brand-700 underline-offset-4 hover:underline">
        Text me a new code
      </button>
    </div>
  );
}

function Verify({ token, onSession }: { token: string; onSession: (session: string) => void }) {
  const link = useQuery(api.portal.link, { token });
  const sendCode = useMutation(api.portal.sendCode);
  const verify = useMutation(api.portal.verify);
  const { busy, problem, setProblem, run } = useRun();
  const [sent, setSent] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  if (link === undefined) return <Loading what="your portal" />;
  if (link.state !== "active") {
    return (
      <Page company={link.company} title="Your portal">
        <Notice tone="neutral" title={link.state === "expired" ? "This link has expired" : link.state === "revoked" ? "This link no longer works" : "This link does not work"}>
          {link.state === "unknown" ? "Check that you opened the whole link from your text." : "Ask the office to send you a new one. Anything you already did is kept."}
        </Notice>
      </Page>
    );
  }
  const send = () =>
    void run(async () => {
      const result = await sendCode({ token });
      if (result.status === "sent") {
        setSent(true);
        setHeld(null);
      } else if (result.status === "held") {
        setSent(true);
        setHeld(result.problem);
      } else setProblem(result.problem);
    });
  return (
    <Page company={link.company} title={`Hi ${link.firstName}`}>
      <Card>
        <p className="text-sm leading-relaxed">
          This is your portal with {link.company}: your onboarding, the hours you can work, your jobs and your pay. First, confirm it is you.
        </p>
      </Card>
      {!link.canText ? (
        <Notice tone="warn" title="We cannot text you a code">
          There is no mobile number on your record. Ask the office to add it, then open this link again.
        </Notice>
      ) : !sent ? (
        <div className="flex flex-col gap-3">
          <Problem message={problem} />
          <Action busy={busy} onPress={send} testId="send-code">
            Text me a code{link.phoneHint ? ` at ${link.phoneHint}` : ""}
          </Action>
        </div>
      ) : (
        <>
          {held ? <Notice tone="warn" title="Your code is on its way later">{held}</Notice> : null}
          <CodeEntry
            sentTo={link.phoneHint}
            busy={busy}
            problem={problem}
            onSend={send}
            onConfirm={(code) =>
              void run(async () => {
                const result = await verify({ token, code });
                if (result.status === "ok" && result.session) onSession(result.session);
                else setProblem(result.message);
              })
            }
          />
        </>
      )}
    </Page>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────────────────────────

type Home = NonNullable<ReturnType<typeof useHome>>;
function useHome(session: string) {
  const now = useNow();
  return useQuery(api.portal.home, now ? { session, asOf: now } : "skip");
}

const STATE_TONE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  submitted: "bg-sky-500/10 text-sky-800",
  awaiting_review: "bg-amber-500/15 text-amber-800",
  accepted: "bg-emerald-500/15 text-emerald-800",
  needs_changes: "bg-red-500/10 text-red-700",
  expired: "bg-red-500/10 text-red-700",
};

function Task({ session, task }: { session: string; task: Home["tasks"][number] }) {
  const acknowledge = useMutation(api.portal.acknowledgeTask);
  const start = useMutation(api.portal.startTask);
  const finish = useMutation(api.portal.finishTask);
  const uploadUrl = useMutation(api.portal.uploadUrl);
  const attach = useMutation(api.portal.attachFile);
  const { busy, problem, run } = useRun();
  const done = task.state === "accepted";
  const id = task.requirementId as Id<"onboardingRequirements">;
  return (
    <li className={cn("flex flex-col gap-2 rounded-2xl border p-4", task.blocksWork && !done ? "border-brand-500/40 bg-brand-500/[0.03]" : "border-border bg-card")} data-testid="task">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{task.label}</p>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATE_TONE[task.state])}>{task.stateWords}</span>
      </div>
      {task.instructions && !done ? <p className="text-sm text-muted-foreground">{task.instructions}</p> : null}
      {task.feedback && task.state === "needs_changes" ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
          <span className="font-medium">What to change: </span>
          {task.feedback}
        </p>
      ) : null}
      {task.expiresWords && done ? <p className="text-xs text-muted-foreground">Valid until {task.expiresWords}.</p> : null}
      {!done && task.kind === "acknowledgment" && task.statement ? (
        <>
          <blockquote className="rounded-xl bg-muted/50 px-3 py-2 text-sm">“{task.statement}”</blockquote>
          <Action busy={busy} onPress={() => void run(() => acknowledge({ session, requirementId: id, statement: task.statement! }))}>
            I agree
          </Action>
        </>
      ) : null}
      {!done && task.kind === "document" ? (
        <>
          {task.state === "awaiting_review" ? <p className="text-sm text-muted-foreground">Sent. The office reviews it; you will see the result here. You can send a better copy if you need to.</p> : null}
          <label className={cn("flex min-h-12 cursor-pointer items-center justify-center rounded-xl px-4 text-base font-semibold", task.state === "awaiting_review" ? "border border-border bg-background" : "bg-brand-500 text-white")}>
            {busy ? "Sending…" : task.state === "awaiting_review" ? "Send another copy" : task.state === "needs_changes" || task.state === "expired" ? "Send a new copy" : "Take a photo or choose a file"}
            <input
              type="file"
              accept="application/pdf,image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 15 * 1024 * 1024) throw new Error("too big");
                  const url = await uploadUrl({ session });
                  const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
                  if (!response.ok) throw new Error("upload");
                  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
                  await attach({ session, requirementId: id, storageId, fileName: file.name, clientKey: newKey() });
                });
              }}
            />
          </label>
        </>
      ) : null}
      {!done && task.kind === "payment_setup" ? (
        task.state === "not_started" ? (
          <Action kind="secondary" busy={busy} onPress={() => void run(() => start({ session, requirementId: id }))}>
            I have started this
          </Action>
        ) : (
          <p className="text-sm text-muted-foreground">The office confirms it once it is complete. Starting it is not the same as finishing it.</p>
        )
      ) : null}
      {!done && (task.kind === "training" || task.kind === "equipment" || task.kind === "custom") ? (
        task.state === "awaiting_review" ? (
          <p className="text-sm text-muted-foreground">Sent. The office reviews it.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {task.state === "not_started" ? (
              <Action kind="secondary" busy={busy} onPress={() => void run(() => start({ session, requirementId: id }))}>
                I started
              </Action>
            ) : null}
            <div className={task.state === "not_started" ? "" : "col-span-2"}>
              <Action busy={busy} onPress={() => void run(() => finish({ session, requirementId: id }))}>
                It is done
              </Action>
            </div>
          </div>
        )
      ) : null}
      {!done && task.kind === "agreement" ? <p className="text-sm text-muted-foreground">The office sends this to you for signing. It counts once everyone has signed.</p> : null}
      <Problem message={problem} />
    </li>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minuteOf = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const clockWords = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`;
};

function Hours({ session, home }: { session: string; home: Home }) {
  const setHours = useMutation(api.portal.setHours);
  const { busy, problem, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [affected, setAffected] = useState<string[] | null>(null);
  const [days, setDays] = useState(() => DAYS.map((_, weekday) => {
    const window = home.windows.find((row) => row.weekday === weekday);
    return { on: Boolean(window), from: window ? hhmm(window.startMinute) : "09:00", to: window ? (window.endMinute === 1440 ? "23:59" : hhmm(window.endMinute)) : "17:00" };
  }));
  return (
    <Card title="When you can work">
      {!editing ? (
        <>
          {home.windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have not told us yet. You are only offered work at times you say you can work.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {home.windows.map((row, index) => (
                <li key={index} className="flex justify-between gap-2">
                  <span className="font-medium">{DAYS[row.weekday]}</span>
                  <span className="text-muted-foreground">
                    {clockWords(row.startMinute)} – {row.endMinute === 1440 ? "midnight" : clockWords(row.endMinute)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {affected && affected.length > 0 ? (
            <Notice tone="warn" title="Some jobs you accepted are now outside your hours">
              {affected.join("; ")}. They are still yours. The office will check with you.
            </Notice>
          ) : null}
          <Action kind="secondary" onPress={() => setEditing(true)}>
            Change my hours
          </Action>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">On the company&apos;s clock ({home.timezone}).</p>
          <ul className="grid gap-2">
            {days.map((day, weekday) => (
              <li key={weekday} className="grid gap-2 rounded-xl border border-border p-2">
                <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={day.on} onChange={(event) => setDays((current) => current.map((row, index) => (index === weekday ? { ...row, on: event.target.checked } : row)))} className="size-5 accent-[var(--color-brand-500)]" />
                  {DAYS[weekday]}
                </label>
                {day.on ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="time" aria-label={`${DAYS[weekday]} from`} value={day.from} onChange={(event) => setDays((current) => current.map((row, index) => (index === weekday ? { ...row, from: event.target.value } : row)))} className="h-11 rounded-xl border border-border bg-background px-3 text-base" />
                    <input type="time" aria-label={`${DAYS[weekday]} until`} value={day.to} onChange={(event) => setDays((current) => current.map((row, index) => (index === weekday ? { ...row, to: event.target.value } : row)))} className="h-11 rounded-xl border border-border bg-background px-3 text-base" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <Problem message={problem} />
          <Action
            busy={busy}
            onPress={() =>
              void run(async () => {
                const windows = days.flatMap((day, weekday) => {
                  if (!day.on) return [];
                  const start = minuteOf(day.from);
                  const end = day.to === "23:59" ? 1440 : minuteOf(day.to);
                  return start !== null && end !== null ? [{ weekday, startMinute: start, endMinute: end }] : [];
                });
                const result = await setHours({ session, windows });
                setAffected(result.affected);
                setEditing(false);
              })
            }
          >
            Save my hours
          </Action>
          <Action kind="secondary" onPress={() => setEditing(false)}>
            Cancel
          </Action>
        </>
      )}
    </Card>
  );
}

function TimeAway({ session, home }: { session: string; home: Home }) {
  const add = useMutation(api.portal.addTimeAway);
  const remove = useMutation(api.portal.removeTimeAway);
  const { busy, problem, setProblem, run } = useRun();
  const [form, setForm] = useState({ from: "", to: "", note: "" });
  const [affected, setAffected] = useState<string[] | null>(null);
  return (
    <Card title="Time away">
      {home.timeOff.length === 0 ? <p className="text-sm text-muted-foreground">None coming up.</p> : null}
      <ul className="grid gap-2">
        {home.timeOff.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
            <span>
              {row.words}
              {row.note ? <span className="block text-xs text-muted-foreground">{row.note}</span> : null}
            </span>
            <button type="button" onClick={() => void run(() => remove({ session, timeOffId: row.id }))} className="min-h-9 shrink-0 text-xs font-medium text-red-600">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          First day away
          <input type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} className="h-11 rounded-xl border border-border bg-background px-3 text-base text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Last day away
          <input type="date" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} className="h-11 rounded-xl border border-border bg-background px-3 text-base text-foreground" />
        </label>
      </div>
      {affected && affected.length > 0 ? (
        <Notice tone="warn" title="You have jobs in that time">
          {affected.join("; ")}. They are still yours until the office talks to you.
        </Notice>
      ) : null}
      <Problem message={problem} />
      <Action
        kind="secondary"
        busy={busy}
        disabled={!form.from || !form.to}
        onPress={() => {
          const startsAt = zonedInstant(form.from, "00:00", home.timezone);
          const endsAt = zonedInstant(form.to, "23:59", home.timezone);
          if (!startsAt || !endsAt || startsAt >= endsAt) return setProblem("The last day must be on or after the first day.");
          void run(async () => {
            const result = await add({ session, startsAt, endsAt, note: form.note || undefined });
            setAffected(result.affected);
            setForm({ from: "", to: "", note: "" });
          });
        }}
      >
        Add time away
      </Action>
    </Card>
  );
}

function Jobs({ home }: { home: Home }) {
  return (
    <Card title="Your jobs">
      {home.jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jobs in the next 30 days.</p>
      ) : (
        <ul className="grid gap-2">
          {home.jobs.map((job) => (
            <li key={job.assignmentId}>
              <a href={job.jobToken ? `/c/job/${job.jobToken}` : job.offerToken ? `/c/offer/${job.offerToken}` : undefined} className={cn("flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5", job.jobToken || job.offerToken ? "active:bg-muted" : "pointer-events-none")}>
                <span>
                  <span className="block text-sm font-medium">{job.when}</span>
                  <span className="block text-xs text-muted-foreground">
                    {job.service}
                    {job.area ? ` · ${job.area}` : ""}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", job.status === "accepted" ? "bg-emerald-500/15 text-emerald-800" : "bg-sky-500/10 text-sky-800")}>{job.status === "accepted" ? "Accepted" : "Offer: answer it"}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Pay({ session }: { session: string }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const earnings = useQuery(api.portal.earnings, open && now ? { session, asOf: now } : "skip");
  const sendCode = useMutation(api.portal.sendStepUpCode);
  const confirm = useMutation(api.portal.confirmStepUp);
  const { busy, problem, setProblem, run } = useRun();
  const [sent, setSent] = useState(false);
  if (!open) {
    return (
      <Card title="Your pay">
        <p className="text-sm text-muted-foreground">Pay details need a fresh code, so nobody else holding your phone sees them.</p>
        <Action kind="secondary" onPress={() => setOpen(true)}>
          Show my pay
        </Action>
      </Card>
    );
  }
  if (earnings === undefined) return <div className="h-24 animate-pulse rounded-2xl bg-muted" />;
  if (earnings.needsCode) {
    return (
      <Card title="Your pay">
        {!sent ? (
          <>
            <Problem message={problem} />
            <Action busy={busy} onPress={() => void run(async () => { const result = await sendCode({ session }); if (result.status === "sent" || result.status === "held") setSent(true); else setProblem(result.problem); })}>
              Text me a code
            </Action>
          </>
        ) : (
          <CodeEntry sentTo={null} busy={busy} problem={problem} onSend={() => void run(async () => { await sendCode({ session }); })} onConfirm={(code) => void run(async () => { const result = await confirm({ session, code }); if (result.status !== "ok") setProblem(result.message); })} />
        )}
      </Card>
    );
  }
  return (
    <Card title="Your pay">
      {earnings.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No accepted jobs yet.</p> : null}
      <ul className="divide-y divide-border">
        {earnings.jobs.map((job, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-2 text-sm">
            <span>
              <span className="block font-medium">{job.when}</span>
              <span className="block text-xs text-muted-foreground">
                {job.service} · {job.state}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{job.pay}</span>
          </li>
        ))}
      </ul>
      {earnings.note ? <p className="text-xs text-muted-foreground">{earnings.note}</p> : null}
    </Card>
  );
}

function Help({ session }: { session: string }) {
  const ask = useMutation(api.portal.askForHelp);
  const { busy, problem, run } = useRun();
  const [topic, setTopic] = useState<"onboarding" | "availability" | "jobs" | "pay" | "other">("onboarding");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Card title="Ask the office">
      {sent ? <Notice tone="good" title="Sent to the office">A person will get back to you by text or a call.</Notice> : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">About</span>
        <select value={topic} onChange={(event) => setTopic(event.target.value as typeof topic)} className="h-11 rounded-xl border border-border bg-background px-3 text-base">
          <option value="onboarding">Onboarding</option>
          <option value="availability">My hours or time away</option>
          <option value="jobs">A job</option>
          <option value="pay">Pay</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <TextBox label="Your question" value={text} onChange={setText} />
      <Problem message={problem} />
      <Action
        kind="secondary"
        busy={busy}
        disabled={text.trim().length < 3}
        onPress={() =>
          void run(async () => {
            await ask({ session, topic, text });
            setText("");
            setSent(true);
          })
        }
      >
        Send
      </Action>
    </Card>
  );
}

function Portal({ session, onSignOut }: { session: string; onSignOut: () => void }) {
  const home = useHome(session);
  const signOut = useMutation(api.portal.signOut);
  if (home === undefined) return <Loading what="your portal" />;
  const open = home.tasks.filter((task) => task.state !== "accepted");
  return (
    <Page company={home.company} title={`Hi ${home.firstName}`}>
      {home.status === "paused" ? (
        <Notice tone="neutral" title="You are paused">The office is not offering you work right now. Talk to them if that should change.</Notice>
      ) : home.ready ? (
        <Notice tone="good" title="You can be offered work">Offers come by text when a job fits your skills, areas and hours.</Notice>
      ) : (
        <Notice tone="warn" title="Before you can be offered work">
          <ul className="mt-1 list-disc pl-5">
            {home.blocking.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Notice>
      )}
      <nav className="sticky top-0 z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-background/90 px-4 py-2 backdrop-blur" aria-label="Sections">
        {[
          ["todo", `To do${open.length ? ` (${open.length})` : ""}`],
          ["hours", "Hours"],
          ["jobs", "Jobs"],
          ["pay", "Pay"],
          ["help", "Help"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-sm font-medium">
            {label}
          </a>
        ))}
      </nav>
      <section id="todo" className="flex scroll-mt-16 flex-col gap-2">
        <h2 className="text-sm font-semibold">Onboarding</h2>
        {home.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to do.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...open, ...home.tasks.filter((task) => task.state === "accepted")].map((task) => (
              <Task key={task.requirementId} session={session} task={task} />
            ))}
          </ul>
        )}
      </section>
      <section id="hours" className="flex scroll-mt-16 flex-col gap-3">
        <Hours session={session} home={home} />
        <TimeAway session={session} home={home} />
      </section>
      <section id="jobs" className="scroll-mt-16">
        <Jobs home={home} />
      </section>
      <section id="pay" className="scroll-mt-16">
        <Pay session={session} />
      </section>
      <section id="help" className="scroll-mt-16">
        <Help session={session} />
      </section>
      <button
        type="button"
        onClick={() => {
          void signOut({ session }).catch(() => undefined);
          onSignOut();
        }}
        className="min-h-11 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
      >
        Sign out on this phone
      </button>
    </Page>
  );
}

/** A session that ended (signed out elsewhere, link closed, engagement ended) sends the person back to the code. */
class SessionGuard extends Component<{ children: ReactNode; onEnded: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onEnded();
  }
  render() {
    return this.state.failed ? <Loading what="your portal" /> : this.props.children;
  }
}

/** The cleaner portal, opened from a texted link. */
export function PortalPage({ token }: { token: string }) {
  const [session, setSession] = useSession(token);
  const [generation, setGeneration] = useState(0);
  if (!session) return <Verify token={token} onSession={(next) => setSession(next)} />;
  return (
    <SessionGuard
      key={generation}
      onEnded={() => {
        setSession(null);
        setGeneration((value) => value + 1);
      }}
    >
      <Portal session={session} onSignOut={() => setSession(null)} />
    </SessionGuard>
  );
}
