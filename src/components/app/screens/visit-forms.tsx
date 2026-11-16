"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom, clock, dayName, localDate, localTime, money, whenLabel, zonedInstant } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

/**
 * Moving a visit, in two steps on one form: choose the new time, read what the move does to each
 * person, then confirm exactly that. Nothing changes until the confirmation, and if the visit changed
 * in between the move is refused and the effects are shown again.
 */
export function MoveVisitForm({ jobId, startsAt, endsAt, now, onDone }: { jobId: Id<"jobs">; startsAt: number; endsAt: number; now: number; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const move = useMutation(api.jobs.reschedule);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState({ date: localDate(startsAt, timezone), from: localTime(startsAt, timezone), to: localTime(endsAt, timezone) });
  const [done, setDone] = useState<{ offersWithdrawn: number; askedAgain: number; placesReopened: number } | null>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const [nextStart, nextEnd] = [zonedInstant(form.date, form.from, timezone), zonedInstant(form.date, form.to, timezone)];
  const changed = nextStart !== null && nextEnd !== null && (nextStart !== startsAt || nextEnd !== endsAt);
  const plan = useQuery(api.jobs.reschedulePreview, changed && !done ? { companyId, jobId, startsAt: nextStart, endsAt: nextEnd } : "skip");

  if (done) {
    return (
      <div className="grid gap-3">
        <p className="text-sm leading-relaxed text-strong">
          The visit was moved.{" "}
          {done.offersWithdrawn + done.askedAgain + done.placesReopened === 0
            ? "Nobody held an offer or a place, so nobody had to be told."
            : `${done.offersWithdrawn} ${done.offersWithdrawn === 1 ? "offer was" : "offers were"} withdrawn, ${done.askedAgain} ${done.askedAgain === 1 ? "cleaner was" : "cleaners were"} asked to confirm the new time, and ${done.placesReopened} ${done.placesReopened === 1 ? "place is" : "places are"} open again.`}
        </p>
        <p className="text-xs text-muted-foreground">Nobody is accepted for the new time until they answer. The visit shows as unstaffed until then.</p>
        <div>
          <Button variant="primary" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (nextStart === null || nextEnd === null) return setError("Choose the day, the start time and the end time.");
        if (!plan) return;
        void run(async () => {
          setDone(await move({ companyId, jobId, startsAt: nextStart, endsAt: nextEnd, version: plan.version }));
        });
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day">
          <TextInput type="date" value={form.date} onChange={set("date")} required />
        </Field>
        <Field label="Starts">
          <TextInput type="time" value={form.from} onChange={set("from")} required />
        </Field>
        <Field label="Ends">
          <TextInput type="time" value={form.to} onChange={set("to")} required />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Now: {dayName(startsAt, timezone)}, {clock(startsAt, timezone)} to {clock(endsAt, timezone)}. Times are on the company’s clock ({timezone}).
      </p>

      {!changed ? (
        <p className="rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">Choose a different time to see what moving the visit does.</p>
      ) : plan === undefined ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : (
        <div className="grid gap-2 rounded-xl border border-border bg-muted p-3 text-sm">
          <p className="font-medium text-strong">What this move does</p>
          {plan.problems.length > 0 ? (
            <ul className="grid gap-1 text-destructive-foreground">
              {plan.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <ul className="grid gap-1.5 leading-relaxed text-strong">
              {plan.offersWithdrawn.map((row) => (
                <li key={row.assignmentId}>
                  <span className="font-medium">{row.name}</span>: the open offer is withdrawn, and they are told it is no longer open.
                </li>
              ))}
              {plan.crew.map((row) => (
                <li key={row.assignmentId}>
                  <span className="font-medium">{row.name}</span>
                  {row.role && plan.placesOpenAfter > 1 ? ` (${row.role})` : ""}:{" "}
                  {row.outcome === "asked_again"
                    ? `accepted the old time, so they are asked to confirm the new one at the pay they accepted (${money(row.payCents)}), with an answer due ${row.respondBy ? whenLabel(row.respondBy, now, timezone) : "before the visit"}.`
                    : `comes off the visit and is told so. ${row.reason ?? "They cannot be asked for the new time."} Their place is open.`}
                </li>
              ))}
              {plan.proposalsClosed > 0 ? <li>{plan.proposalsClosed === 1 ? "The proposal waiting for approval is" : `${plan.proposalsClosed} proposals waiting for approval are`} closed, because {plan.proposalsClosed === 1 ? "it was" : "they were"} about the old time.</li> : null}
              {plan.offersWithdrawn.length + plan.crew.length + plan.proposalsClosed === 0 ? <li>Nobody holds an offer or a place on this visit, so only the time changes.</li> : null}
              {plan.crew.length > 0 ? <li className="text-muted-foreground">Until they answer, no cleaner is accepted for the new time.</li> : null}
            </ul>
          )}
        </div>
      )}

      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!plan || plan.problems.length > 0}>
          Move the visit
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Changing a scheduled visit's details. What a cleaner was told is locked while they hold an offer or a place. */
export function EditVisitForm({ jobId, onDone }: { jobId: Id<"jobs">; onDone: () => void }) {
  const { companyId } = useCompany();
  const found = useQuery(api.jobs.get, { companyId, jobId });
  if (!found) return <Skeleton className="h-64 rounded-xl" />;
  return <EditFields key={found.job._id} job={found.job} held={found.assignments.some((row) => row.status === "offered" || row.status === "accepted")} accepted={found.staffing.accepted} onDone={onDone} />;
}

function EditFields({ job, held, accepted, onDone }: { job: Doc<"jobs">; held: boolean; accepted: number; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const edit = useMutation(api.jobs.edit);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState({
    serviceType: job.serviceType,
    scope: job.scope,
    skills: job.requiredSkills.join(", "),
    price: job.priceCents === undefined ? "" : (job.priceCents / 100).toFixed(2),
    crew: String(job.requiredCrew ?? 1),
    arrival: String(job.arrivalWindowMinutes ?? 0),
    deadlineDate: job.hardDeadlineAt ? localDate(job.hardDeadlineAt, timezone) : "",
    deadlineTime: job.hardDeadlineAt ? localTime(job.hardDeadlineAt, timezone) : "",
    instructions: job.instructions ?? "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const locked = held ? "Locked while a cleaner holds an offer or a place: it is what they were told." : undefined;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const priceCents = form.price.trim() ? centsFrom(form.price) : null;
        if (form.price.trim() && priceCents === null) return setError("Enter the price as an amount in dollars and cents, or leave it empty.");
        const wantsDeadline = Boolean(form.deadlineDate || form.deadlineTime);
        const hardDeadlineAt = wantsDeadline ? zonedInstant(form.deadlineDate, form.deadlineTime, timezone) : null;
        if (wantsDeadline && hardDeadlineAt === null) return setError("Give both the day and the time the service must be finished by, or leave both empty.");
        void run(async () => {
          await edit({
            companyId,
            jobId: job._id,
            expectedStartsAt: job.startsAt,
            ...(held ? {} : { serviceType: form.serviceType, scope: form.scope, requiredSkills: list(form.skills) }),
            priceCents,
            requiredCrew: Number(form.crew),
            arrivalWindowMinutes: Number(form.arrival || "0"),
            hardDeadlineAt,
            instructions: form.instructions,
          });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Service" hint={locked}>
          <TextInput value={form.serviceType} onChange={set("serviceType")} required maxLength={80} disabled={held} />
        </Field>
        <Field label="Price (optional)" hint="The price of the service. It is not a payment.">
          <TextInput inputMode="decimal" value={form.price} onChange={set("price")} placeholder="0.00" />
        </Field>
      </div>
      <Field label="Scope" hint={locked ?? "What the cleaner will be told to do."}>
        <TextArea value={form.scope} onChange={set("scope")} required rows={2} disabled={held} />
      </Field>
      <Field label="Skills needed (optional)" hint={locked ?? "Separate with commas."}>
        <TextInput value={form.skills} onChange={set("skills")} disabled={held} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cleaners needed" hint={accepted > 0 ? `${accepted} already accepted. It cannot go below that.` : "The visit is staffed only when this many have accepted."}>
          <TextInput inputMode="numeric" value={form.crew} onChange={set("crew")} required />
        </Field>
        <Field label="Arrival window, minutes" hint={accepted > 0 ? "A cleaner accepted this arrival time. Move the visit to change it." : "0 means arrive at the start time."}>
          <TextInput inputMode="numeric" value={form.arrival} onChange={set("arrival")} disabled={accepted > 0} />
        </Field>
        <Field label="Must be finished by, day (optional)">
          <TextInput type="date" value={form.deadlineDate} onChange={set("deadlineDate")} />
        </Field>
        <Field label="Must be finished by, time">
          <TextInput type="time" value={form.deadlineTime} onChange={set("deadlineTime")} />
        </Field>
      </div>
      <Field label="Instructions for the crew (optional)" hint="A cleaner sees this only after they accept.">
        <TextArea value={form.instructions} onChange={set("instructions")} rows={2} maxLength={4000} />
      </Field>
      <p className="text-xs text-muted-foreground">To change the day or time, use Move the visit: it shows what the move does to everyone on it first.</p>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          Save the changes
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
