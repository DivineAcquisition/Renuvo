"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formFrom, recruitingProblems, type RecruitingForm, type RecruitingSettings, settingsFrom } from "@/lib/app/recruiting-form";
import { WEEKDAYS } from "@/lib/app/settings-draft";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function RecruitingRules() {
  const { companyId, role } = useCompany();
  const playbook = useQuery(api.recruiter.playbook, { companyId });
  if (!playbook) return <Skeleton className="h-96 rounded-2xl" />;
  const settings = playbook.settings as RecruitingSettings;
  // Re-keyed when the saved record changes, so a save elsewhere is shown unless the form is being edited here.
  return <RecruitingFormView key={JSON.stringify(settings)} settings={settings} timezone={playbook.timezone} canEdit={role === "owner"} companyId={companyId} />;
}

function RecruitingFormView({ settings, timezone, canEdit, companyId }: { settings: RecruitingSettings; timezone: string; canEdit: boolean; companyId: Id<"companies"> }) {
  const update = useMutation(api.recruiter.updatePlaybook);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState<RecruitingForm>(() => formFrom(settings));
  const [saved, setSaved] = useState(false);
  const problems = useMemo(() => recruitingProblems(form), [form]);
  const set = <K extends keyof RecruitingForm>(key: K, value: RecruitingForm[K]) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const text = (key: keyof RecruitingForm, label: string, hint?: string, className?: string) => (
    <Field label={label} hint={hint} className={className}>
      <TextInput value={String(form[key])} disabled={!canEdit} onChange={(event) => set(key, event.target.value as never)} />
    </Field>
  );
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (problems.length > 0) return;
        void run(async () => {
          await update({ companyId, settings: settingsFrom(form) as never });
          setSaved(true);
        });
      }}
    >
      <Panel title="Invitations and reminders">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invitations" hint="Review: a person approves every invitation. Automatic: sent when every check in Recruiter's playbook holds.">
            <SelectInput value={form.invitationMode} disabled={!canEdit} onChange={(event) => set("invitationMode", event.target.value as "review" | "auto")}>
              <option value="review">A person approves each one</option>
              <option value="auto">Sent automatically when every check holds</option>
            </SelectInput>
          </Field>
          {text("followUpHours", "Reminder delays (hours after the invitation)", "For example 48, 120. At most five, each its own time.")}
          {text("maxFollowUps", "Reminders to send", "No more than the delays listed.")}
          {text("linkTtlDays", "Days an application link works")}
        </div>
      </Panel>

      <Panel title="When messages go out">
        <p className="mb-3 text-sm text-muted-foreground">On the company&apos;s clock ({timezone}). Messages wait for these hours and days. Quiet hours and consent in Trust &amp; compliance still apply on top.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">
            <TextInput type="time" value={form.sendFrom} disabled={!canEdit} onChange={(event) => set("sendFrom", event.target.value)} />
          </Field>
          <Field label="Until" hint="Midnight means the end of the day.">
            <TextInput type="time" value={form.sendUntil} disabled={!canEdit} onChange={(event) => set("sendUntil", event.target.value)} />
          </Field>
        </div>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-strong">Days</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {WEEKDAYS.map((day, weekday) => (
              <label key={day} className="flex items-center gap-1.5 text-sm text-strong">
                <input type="checkbox" disabled={!canEdit} checked={form.sendDays.includes(weekday)} onChange={(event) => set("sendDays", event.target.checked ? [...form.sendDays, weekday] : form.sendDays.filter((value) => value !== weekday))} />
                {day.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>
      </Panel>

      <Panel title="Sender">
        <div className="grid gap-3 sm:grid-cols-2">
          {text("fromName", "Name applicants see")}
          {text("replyTo", "Reply address", "Your own hiring inbox. Leave empty for none.")}
        </div>
      </Panel>

      <Panel title="Interviews, offers and records">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {text("interviewMinutes", "Interview length (minutes)")}
          {text("interviewReminderHours", "Interview reminder (hours before)")}
          {text("offerTtlDays", "Days an offer stays open")}
          {text("decideWithinHours", "Hours to decide a proposal")}
          {text("retentionDays", "Days applicant records are kept", "Counted after an application closes. 30 to 2,555.")}
        </div>
      </Panel>

      <Panel title="Before a new worker is ready">
        <p className="mb-3 text-sm text-muted-foreground">A person marks each one done. Nothing here is checked or verified automatically.</p>
        <ul className="grid gap-2">
          {form.requirements.map((row, index) => (
            <li key={index} className="grid grid-cols-[8rem_1fr_auto] items-end gap-2">
              <TextInput aria-label="Key" value={row.key} disabled={!canEdit} onChange={(event) => set("requirements", form.requirements.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)))} />
              <TextInput aria-label="Label" value={row.label} disabled={!canEdit} onChange={(event) => set("requirements", form.requirements.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))} />
              {canEdit ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => set("requirements", form.requirements.filter((_, i) => i !== index))}>
                  Remove
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="mt-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => set("requirements", [...form.requirements, { key: "", label: "" }])}>
              Add a requirement
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel title="Your instructions">
        <p className="mb-3 text-sm text-muted-foreground">Your own words. Recruiter reads these as context. They guide tone and escalation; they never grant an agent more authority.</p>
        <div className="grid gap-3">
          <Field label="Recruiting rules">
            <TextArea value={form.recruitingRules} disabled={!canEdit} onChange={(event) => set("recruitingRules", event.target.value)} />
          </Field>
          <Field label="Communication policy">
            <TextArea value={form.communicationPolicy} disabled={!canEdit} onChange={(event) => set("communicationPolicy", event.target.value)} />
          </Field>
          <Field label="When to hand a person the decision">
            <TextArea value={form.escalationRules} disabled={!canEdit} onChange={(event) => set("escalationRules", event.target.value)} />
          </Field>
        </div>
      </Panel>

      {canEdit ? (
        <div className="grid gap-2">
          {problems.length > 0 ? (
            <ul role="alert" className="grid gap-0.5 text-sm text-destructive-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <FormError message={error} />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={problems.length > 0}>
              Save recruiting rules
            </Button>
            {saved ? (
              <span role="status" className="text-xs text-muted-foreground">
                Saved.
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the Owner changes these. You can read them.</p>
      )}
    </form>
  );
}
