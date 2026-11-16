"use client";

import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, messageOf, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Guard } from "@/components/app/settings/guard";
import { SaveBar, useSavedDraft, useUnsavedWarning } from "@/components/app/settings/save-bar";
import { Plus, Trash2 } from "@/components/icons";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formFrom, recruitingProblems, requirementKey, type RecruitingForm, type RecruitingSettings, settingsFrom } from "@/lib/app/recruiting-form";
import { WEEKDAYS } from "@/lib/app/settings-draft";
import { timeZoneLabel } from "@/lib/app/timezones";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

function RecruitingInner() {
  const { companyId, role } = useCompany();
  const playbook = useQuery(api.recruiter.playbook, { companyId });
  if (!playbook) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="grid gap-5">
      <HiringInbox canEdit={role === "owner"} companyId={companyId} />
      <RecruitingFormView saved={playbook.settings as RecruitingSettings} timezone={playbook.timezone} canEdit={role === "owner"} companyId={companyId} />
    </div>
  );
}

export function RecruitingRules() {
  return (
    <Guard>
      <RecruitingInner />
    </Guard>
  );
}

/** What Google sent the Owner back with, in words. */
const RETURN_WORDS: Record<string, string> = {
  connected: "Gmail is connected. Recruiter is reading your hiring inbox now.",
  failed: "Gmail wasn't connected because Google didn't give Selestial permission to read the inbox. Try again, and allow reading when Google asks.",
  expired: "That sign-in had already been used or took longer than ten minutes. Please start again.",
};

function HiringInbox({ canEdit, companyId }: { canEdit: boolean; companyId: Id<"companies"> }) {
  const overview = useQuery(api.recruiter.overview, { companyId });
  const start = useMutation(api.recruiterMailbox.startGmailConnect);
  const disconnect = useMutation(api.recruiter.disconnectMailbox);
  const { busy, error, run } = useRun();
  const [label, setLabel] = useState("");
  const [canSend, setCanSend] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Google sends the Owner back here with ?mailbox=<outcome>.
  const outcome = useSearchParams().get("mailbox");
  const returned = outcome ? (RETURN_WORDS[outcome] ?? null) : null;
  if (!overview) return <Skeleton className="h-32 rounded-2xl" />;
  const inboxes = overview.inbox.filter((row) => row.status !== "disconnected" && row.provider !== "mock");
  const sender = inboxes.find((row) => row.sendsApplicantEmail);
  const hasGmail = inboxes.some((row) => row.provider === "gmail");
  return (
    <Panel title="Hiring inbox">
      {returned ? (
        <p role="status" className="mb-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-strong">
          {returned}
        </p>
      ) : null}
      {inboxes.length > 0 ? (
        <ul className="mb-3 grid gap-2">
          {inboxes.map((row) => (
            <li key={row.connectionId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-strong">
                  {row.address}
                  {row.status === "connected" ? (
                    <Badge variant="success" size="sm">
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="warning" size="sm">
                      Needs attention
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.status === "connected" ? (row.lastSyncAt ? `Last checked ${new Date(row.lastSyncAt).toLocaleString()}.` : "Waiting for the first check.") : "Selestial can't read this inbox right now. Reconnect Gmail to fix it."}
                  {row.sendsApplicantEmail ? " Applicant email is sent from this address." : ""}
                </span>
              </div>
              {canEdit ? (
                confirming === row.connectionId ? (
                  <span className="flex gap-2">
                    <Button type="button" size="sm" variant="destructive-outline" disabled={busy} onClick={() => void run(async () => { await disconnect({ companyId, connectionId: row.connectionId }); setConfirming(null); })}>
                      Disconnect now
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(row.connectionId)}>
                    Disconnect
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mb-3 text-sm text-muted-foreground">
        {sender
          ? `Applicants get email from ${sender.address}, and their replies come back to it.`
          : "Until you connect an inbox for sending, applicants get email from a Selestial address under your company's name, and replies go to the reply address you set below."}
      </p>
      {canEdit && overview.gmailAvailable ? (
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-2">
            <Field label="Gmail label to read (optional)" hint="Leave empty to read the whole inbox. Recruiter only opens mail that looks like it's about hiring.">
              <TextInput value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Hiring" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-strong">
              <input type="checkbox" checked={canSend} onChange={(event) => setCanSend(event.target.checked)} />
              Also send applicant email from this inbox
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                const { url } = await start({ companyId, canSend, returnTo: window.location.origin, ...(label.trim() ? { folder: label.trim() } : {}) });
                window.location.assign(url);
              })
            }
          >
            {hasGmail ? "Reconnect Gmail" : "Connect Gmail"}
          </Button>
        </div>
      ) : canEdit ? (
        <p className="text-sm text-muted-foreground">Connecting Gmail isn&apos;t available yet. Selestial&apos;s team needs to finish setting it up for your account.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Only the Owner can connect the hiring inbox.</p>
      )}
      <FormError message={error} />
    </Panel>
  );
}

const hoursWords = (value: string) => {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours <= 0) return null;
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? "" : "s"}`;
  return hours > 24 ? `${Math.floor(hours / 24)} day${hours < 48 ? "" : "s"} ${hours % 24} hr` : `${hours} hr`;
};

function RecruitingFormView({ saved, timezone, canEdit, companyId }: { saved: RecruitingSettings; timezone: string; canEdit: boolean; companyId: Id<"companies"> }) {
  const update = useMutation(api.recruiter.updatePlaybook);
  const savedForm = useMemo(() => formFrom(saved), [saved]);
  const { value: form, dirty, stale, change, reset } = useSavedDraft(savedForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedWarning(dirty);
  const problems = useMemo(() => (form && canEdit ? recruitingProblems(form) : []), [form, canEdit]);
  if (!form) return null;
  const savedKeys = new Set(saved.onboardingRequirements.map((row) => row.key));
  const set = <K extends keyof RecruitingForm>(key: K, value: RecruitingForm[K]) => {
    setNotice(null);
    change((current) => ({ ...current, [key]: value }));
  };
  const text = (key: "linkTtlDays" | "offerTtlDays" | "retentionDays" | "interviewMinutes" | "interviewReminderHours" | "decideWithinHours" | "fromName" | "replyTo", label: string, hint?: string, numeric = true) => (
    <Field label={label} hint={hint}>
      <TextInput inputMode={numeric ? "numeric" : undefined} value={form[key]} disabled={!canEdit} onChange={(event) => set(key, event.target.value)} className={numeric ? "max-w-[10rem]" : undefined} />
    </Field>
  );
  const save = async () => {
    if (saving || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      await update({ companyId, settings: settingsFrom(form) as never });
      reset();
      setNotice("Saved. Recruiter uses these rules from now on.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };
  const reminders = form.followUpHours;
  const maxChoices = Array.from({ length: reminders.length + 1 }, (_, n) => n);

  return (
    <div className="grid gap-5">
      <Panel title="Application invitations">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Inviting applicants" hint="Automatic invitations only go out when every check in Recruiter's rules passes.">
            <SelectInput value={form.invitationMode} disabled={!canEdit} onChange={(event) => set("invitationMode", event.target.value as "review" | "auto")}>
              <option value="review">Ask me first</option>
              <option value="auto">Act automatically</option>
            </SelectInput>
          </Field>
          {text("linkTtlDays", "Application link works for (days)", "After this, the applicant needs a new invitation.")}
        </div>
      </Panel>

      <Panel title="Follow-ups">
        <p className="mb-3 text-sm text-muted-foreground">Reminders to applicants who were invited but haven&apos;t applied yet. Example: 48 and 120 send reminders 2 days and 5 days after the invitation.</p>
        {reminders.length === 0 ? <p className="mb-2 text-sm text-strong">No reminders. Applicants only get the invitation.</p> : null}
        <ol className="grid gap-2">
          {reminders.map((value, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium text-strong">Reminder {index + 1}</span>
              <TextInput
                aria-label={`Reminder ${index + 1}, hours after the invitation`}
                inputMode="numeric"
                value={value}
                disabled={!canEdit}
                onChange={(event) => set("followUpHours", reminders.map((row, i) => (i === index ? event.target.value : row)))}
                className="w-24 py-1.5"
              />
              <span className="text-muted-foreground">hours after the invitation{hoursWords(value) ? ` (${hoursWords(value)})` : ""}</span>
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = reminders.filter((_, i) => i !== index);
                    change((current) => ({ ...current, followUpHours: next, maxFollowUps: String(Math.min(Number(current.maxFollowUps) || 0, next.length)) }));
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                  <span className="sr-only">Remove reminder {index + 1}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          {canEdit && reminders.length < 5 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const last = Number(reminders[reminders.length - 1]) || 0;
                const next = [...reminders, String(last ? last + 48 : 48)];
                change((current) => ({ ...current, followUpHours: next, maxFollowUps: Number(current.maxFollowUps) === reminders.length ? String(next.length) : current.maxFollowUps }));
              }}
            >
              <Plus aria-hidden className="size-4" />
              Add a reminder
            </Button>
          ) : null}
          {reminders.length > 0 ? (
            <Field label="Reminders to send at most" className="w-48">
              <SelectInput value={form.maxFollowUps} disabled={!canEdit} onChange={(event) => set("maxFollowUps", event.target.value)}>
                {maxChoices.map((n) => (
                  <option key={n} value={String(n)}>
                    {n === 0 ? "None" : n === reminders.length ? `All ${n}` : String(n)}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
        </div>
      </Panel>

      <Panel title="Interviews">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("interviewMinutes", "Interview length (minutes)")}
          {text("interviewReminderHours", "Remind the applicant (hours before)", "For example, 24 sends the reminder a day before.")}
        </div>
      </Panel>

      <Panel title="New-hire requirements">
        <p className="mb-3 text-sm text-muted-foreground">What a new cleaner needs before their first job. A person marks each one done; nothing here is checked automatically.</p>
        <ul className="grid gap-2">
          {form.requirements.map((row, index) => (
            <li key={index} className="flex items-center gap-2">
              <TextInput
                aria-label={`Requirement ${index + 1}`}
                value={row.label}
                disabled={!canEdit}
                placeholder="Signed contractor agreement"
                onChange={(event) =>
                  set(
                    "requirements",
                    form.requirements.map((item, i) => {
                      if (i !== index) return item;
                      // A saved requirement keeps its key; a new one takes it from its name.
                      const key = savedKeys.has(item.key) ? item.key : requirementKey(event.target.value, form.requirements.filter((_, j) => j !== i).map((other) => other.key));
                      return { key, label: event.target.value };
                    }),
                  )
                }
              />
              {canEdit ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => set("requirements", form.requirements.filter((_, i) => i !== index))}>
                  <Trash2 aria-hidden className="size-4" />
                  <span className="sr-only">Remove {row.label || `requirement ${index + 1}`}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="mt-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => set("requirements", [...form.requirements, { key: "", label: "" }])}>
              <Plus aria-hidden className="size-4" />
              Add a requirement
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel title="Communication preferences">
        <p className="mb-3 text-sm text-muted-foreground">
          When Recruiter may message applicants, on your company&apos;s clock ({timeZoneLabel(timezone)}). Quiet hours and consent rules in Privacy &amp; messaging still apply.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send messages from">
            <TextInput type="time" value={form.sendFrom} disabled={!canEdit} onChange={(event) => set("sendFrom", event.target.value)} className="max-w-[10rem]" />
          </Field>
          <Field label="Until" hint="12:00 AM means the end of the day.">
            <TextInput type="time" value={form.sendUntil} disabled={!canEdit} onChange={(event) => set("sendUntil", event.target.value)} className="max-w-[10rem]" />
          </Field>
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-strong">On these days</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {WEEKDAYS.map((day, weekday) => (
              <label key={day} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm text-strong has-[:checked]:border-brand-500/60 has-[:checked]:bg-brand-500/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500">
                <input type="checkbox" disabled={!canEdit} checked={form.sendDays.includes(weekday)} onChange={(event) => set("sendDays", event.target.checked ? [...form.sendDays, weekday] : form.sendDays.filter((value) => value !== weekday))} />
                {day.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {text("fromName", "Sender name applicants see", undefined, false)}
          {text("replyTo", "Reply-to email", "Where applicants' replies go, like your hiring inbox. Leave empty for none.", false)}
        </div>
      </Panel>

      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5 [&::-webkit-details-marker]:hidden">
          Offers, record keeping and your instructions to Recruiter
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Less often changed</span>
        </summary>
        <div className="grid gap-4 border-t border-border px-4 py-4 sm:px-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {text("offerTtlDays", "Job offers stay open (days)")}
            {text("decideWithinHours", "Time you have to approve a step (hours)", "After this, the step closes without being done.")}
            {text("retentionDays", "Keep applicant records (days)", "Counted after an application closes. From 30 to 2,555 days (7 years).")}
          </div>
          <p className="text-sm text-muted-foreground">Your own words. Recruiter reads these for tone and when to hand things to you. They never give it more permission than Agent controls allows.</p>
          <Field label="Recruiting guidelines">
            <TextArea value={form.recruitingRules} disabled={!canEdit} onChange={(event) => set("recruitingRules", event.target.value)} />
          </Field>
          <Field label="How to talk to applicants">
            <TextArea value={form.communicationPolicy} disabled={!canEdit} onChange={(event) => set("communicationPolicy", event.target.value)} />
          </Field>
          <Field label="When to hand a decision to you">
            <TextArea value={form.escalationRules} disabled={!canEdit} onChange={(event) => set("escalationRules", event.target.value)} />
          </Field>
        </div>
      </details>

      <SaveBar
        canEdit={canEdit}
        dirty={dirty}
        stale={stale}
        problems={problems}
        saving={saving}
        error={error}
        notice={notice}
        saveLabel="Save recruiting rules"
        onSave={() => void save()}
        onDiscard={() => {
          reset();
          setError(null);
        }}
        staleMessage="Someone else changed the recruiting rules after you started editing. Saving will replace their changes with yours. Discard to see theirs."
      />
    </div>
  );
}
