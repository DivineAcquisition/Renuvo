"use client";

/**
 * A subcontractor company's contact, from the link the office gave them: their own workers, what each still
 * needs before they can be offered work, and their upcoming jobs. They can tell the office a worker will be
 * away and ask a question. Nothing about anyone else, and no documents, notes or pay.
 */
import { useMutation } from "convex/react";
import { useState } from "react";

import { useStableQuery } from "@/lib/app/stable-query";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Action, Card, Loading, Notice, Page, Problem, problemWords, Row } from "./shell";
import { fmt, useMinute, zoned } from "./time";
import { SelectInput } from "@/components/app/form";

type View = Extract<FunctionReturnType<typeof api.contactPortal.view>, { state: "active" }>;

const input = "h-11 rounded-lg border border-border bg-background px-2 text-base";

export function ContactPortal({ token }: { token: string }) {
  const now = useMinute();
  const view = useStableQuery(api.contactPortal.view, now ? { token, asOf: now } : "skip");
  if (view === undefined) return <Loading what="your workers" />;
  if (view.state !== "active") {
    const copy = {
      expired: { title: "This link has expired", body: "Ask the office for a new link." },
      revoked: { title: "This link is no longer active", body: "The office ended it or gave you a newer one." },
      ended: { title: "This working relationship has ended", body: "This link no longer shows anything. Contact the office if you have a question." },
      not_contact: { title: "This link is for a cleaner", body: "Open the link the office gave you for your company." },
    }[view.state];
    return (
      <Page company={view.company} title={copy.title}>
        <Notice tone="neutral" title={copy.title}>
          {copy.body}
        </Notice>
      </Page>
    );
  }
  const ready = view.workers.filter((worker) => worker.ready).length;
  return (
    <Page company={view.company} title={view.subcontractor}>
      {view.paused ? (
        <Notice tone="warn" title="Paused">
          {view.company} has paused new work with {view.subcontractor} for now. Booked jobs stay as they are.
        </Notice>
      ) : null}
      <Card title={`Your workers · ${ready} of ${view.workers.length} ready`}>
        {view.workers.length === 0 ? <p className="text-sm text-muted-foreground">No workers are on record yet. The office adds them.</p> : null}
        {view.workers.map((worker) => (
          <div key={worker.cleanerId} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
            <p className="flex items-center justify-between gap-2 text-sm font-medium">
              {worker.name}
              <span className={worker.ready ? "text-xs font-semibold text-emerald-600" : "text-xs font-semibold text-amber-600"}>{worker.ready ? "Ready for work" : worker.engagement === "Active" ? "Not ready" : worker.engagement}</span>
            </p>
            {worker.needs.length ? <p className="text-sm text-muted-foreground">Still needed: {worker.needs.join(", ")}</p> : null}
            <p className="text-xs text-muted-foreground">
              Hours: {worker.week}
              {worker.hoursConfirmedAt ? ` · confirmed ${fmt(worker.hoursConfirmedAt, view.timezone, { month: "short", day: "numeric" })}` : ""}
            </p>
          </div>
        ))}
      </Card>
      <Card title="Coming up">
        {view.jobs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing booked or offered in the next three weeks.</p> : null}
        {view.jobs.map((job) => (
          <div key={job.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
            <p className="text-sm font-medium">
              {fmt(job.startsAt, view.timezone, { weekday: "short", month: "short", day: "numeric" })}, {fmt(job.startsAt, view.timezone, { hour: "numeric", minute: "2-digit" })} – {fmt(job.endsAt, view.timezone, { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="text-sm text-muted-foreground">
              {job.worker} · {job.service}
              {job.where ? ` · ${job.where}` : ""} · {job.status === "accepted" ? "Accepted" : "Offered"}
            </p>
          </div>
        ))}
      </Card>
      {view.crews.length ? (
        <Card title="Crews">
          {view.crews.map((crew) => (
            <Row key={crew.name} label={crew.name}>
              {crew.members.map((member) => `${member.name}${member.lead ? " (lead)" : ""}`).join(", ")}
            </Row>
          ))}
        </Card>
      ) : null}
      {view.allowed.includes("add_time_away") && view.workers.length ? <AwayCard view={view} token={token} /> : null}
      {view.allowed.includes("ask_for_help") ? <AskCard token={token} /> : null}
      <p className="text-center text-xs text-muted-foreground">This link is only for {view.contactName}. It works until {fmt(view.expiresAt, view.timezone, { month: "short", day: "numeric" })}.</p>
    </Page>
  );
}

function AwayCard({ view, token }: { view: View; token: string }) {
  const add = useMutation(api.contactPortal.addTimeAway);
  const [form, setForm] = useState<{ cleanerId: string; from: string; to: string; note: string }>({ cleanerId: view.workers[0]?.cleanerId ?? "", from: "", to: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; impact: string[] } | null>(null);
  return (
    <Card title="Someone will be away">
      {done ? (
        <Notice tone={done.impact.length ? "warn" : "good"} title={`Saved for ${done.name}`}>
          {done.impact.length ? `It touches: ${done.impact.join("; ")}. The office has been told and will keep or cover each job.` : "No work is offered to them then."}
        </Notice>
      ) : null}
      <label className="grid gap-1 text-sm">
        Who
        <SelectInput value={form.cleanerId} onChange={(event) => setForm({ ...form, cleanerId: event.target.value })} className={input}>
          {view.workers.map((worker) => (
            <option key={worker.cleanerId} value={worker.cleanerId}>
              {worker.name}
            </option>
          ))}
        </SelectInput>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm">
          From
          <input type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Back on
          <input type="date" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} className={input} />
        </label>
      </div>
      <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Note for the office (optional)" className={`${input} px-3`} />
      <Problem message={problem} />
      <Action
        kind="secondary"
        busy={busy}
        disabled={!form.cleanerId || !form.from || !form.to}
        onPress={() => {
          const startsAt = zoned(form.from, "00:00", view.timezone);
          const endsAt = zoned(form.to, "00:00", view.timezone);
          if (startsAt === null || endsAt === null) return setProblem("Choose both dates.");
          setBusy(true);
          setProblem(null);
          add({ token, cleanerId: form.cleanerId as Id<"cleaners">, startsAt, endsAt, note: form.note || undefined })
            .then((result) => {
              setDone({ name: view.workers.find((worker) => worker.cleanerId === form.cleanerId)?.name ?? "them", impact: result.impact });
              setForm({ ...form, from: "", to: "", note: "" });
            })
            .catch((error) => setProblem(problemWords(error)))
            .finally(() => setBusy(false));
        }}
      >
        Tell the office
      </Action>
    </Card>
  );
}

function AskCard({ token }: { token: string }) {
  const ask = useMutation(api.contactPortal.askForHelp);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  return (
    <Card title="Ask the office">
      {asked ? (
        <Notice tone="good" title="Sent to the office">
          Someone will get back to you.
        </Notice>
      ) : (
        <>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="Your question" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base" />
          <Problem message={problem} />
          <Action
            kind="secondary"
            busy={busy}
            disabled={!question.trim()}
            onPress={() => {
              setBusy(true);
              setProblem(null);
              ask({ token, text: question })
                .then(() => setAsked(true))
                .catch((error) => setProblem(problemWords(error)))
                .finally(() => setBusy(false));
            }}
          >
            Send
          </Action>
        </>
      )}
    </Card>
  );
}
