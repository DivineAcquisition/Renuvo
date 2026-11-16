"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, messageOf, TextInput } from "@/components/app/form";
import { Guard } from "@/components/app/settings/guard";
import { SaveBar, useSavedDraft, useUnsavedWarning } from "@/components/app/settings/save-bar";
import { Panel } from "@/components/app/shell";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

const POLICY_NUMBERS = ["broadcastSize", "backupOfferWindowMinutes", "reminderLeadMinutes", "contactAfterMinutes", "alertAfterMinutes", "noShowAfterMinutes", "jobAccessGraceHours", "beforePhotosRequired", "afterPhotosRequired"] as const;
const SETTING_NUMBERS = ["offerWindowMinutes", "travelBufferMinutes", "lookAheadDays"] as const;
type NumberKey = (typeof POLICY_NUMBERS)[number] | (typeof SETTING_NUMBERS)[number];

type Form = Record<NumberKey, string> & { broadcastEnabled: boolean; sendBeforePhotoLink: boolean };

/** Each number's label with its unit, what it does, and the range the server accepts. */
const FIELDS: Record<NumberKey, { label: string; hint: string; min: number; max: number }> = {
  offerWindowMinutes: { label: "Time to accept a job (minutes)", hint: "If a cleaner doesn't answer in time, the next cleaner is asked.", min: 15, max: 2880 },
  travelBufferMinutes: { label: "Travel time between jobs (minutes)", hint: "Kept free before a cleaner is offered their next job.", min: 0, max: 240 },
  lookAheadDays: { label: "Plan jobs this far ahead (days)", hint: "Jobs further out wait until they're this close.", min: 1, max: 30 },
  broadcastSize: { label: "Cleaners asked at once", hint: "Used only when asking several cleaners at once is on.", min: 2, max: 10 },
  backupOfferWindowMinutes: { label: "Time to accept a replacement job (minutes)", hint: "Shorter than a normal offer, because the job is soon.", min: 5, max: 240 },
  reminderLeadMinutes: { label: "Send the job reminder (minutes before start)", hint: "For example, 120 sends it two hours before the job.", min: 15, max: 2880 },
  contactAfterMinutes: { label: "Check on a cleaner who hasn't arrived (minutes after arrival window)", hint: "The cleaner gets a message asking where they are.", min: 0, max: 240 },
  alertAfterMinutes: { label: "Alert you (minutes after arrival window)", hint: "You get a task to step in.", min: 0, max: 240 },
  noShowAfterMinutes: { label: "Allow marking a no-show (minutes after arrival window)", hint: "A person decides; it's never marked automatically.", min: 5, max: 480 },
  beforePhotosRequired: { label: "Before photos required", hint: "0 means none.", min: 0, max: 20 },
  afterPhotosRequired: { label: "After photos required", hint: "0 means none.", min: 0, max: 20 },
  jobAccessGraceHours: { label: "Job link keeps working after the job (hours)", hint: "So cleaners can add late photos or notes.", min: 1, max: 168 },
};

type Policy = NonNullable<ReturnType<typeof useQuery<typeof api.dispatchOps.policy>>>;
type Settings = NonNullable<ReturnType<typeof useQuery<typeof api.dispatch.settings>>>;

function formFrom(settings: Settings, policy: Policy): Form {
  return {
    broadcastEnabled: policy.broadcastEnabled,
    sendBeforePhotoLink: policy.sendBeforePhotoLink,
    ...(Object.fromEntries(SETTING_NUMBERS.map((key) => [key, String(settings[key])])) as Record<(typeof SETTING_NUMBERS)[number], string>),
    ...(Object.fromEntries(POLICY_NUMBERS.map((key) => [key, String(policy[key])])) as Record<(typeof POLICY_NUMBERS)[number], string>),
  };
}

const num = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

/** What's wrong, by field, in words. The server checks again. */
function fieldErrors(form: Form): Partial<Record<NumberKey, string>> {
  const out: Partial<Record<NumberKey, string>> = {};
  for (const key of [...SETTING_NUMBERS, ...POLICY_NUMBERS]) {
    const value = num(form[key]);
    const { min, max } = FIELDS[key];
    if (!Number.isInteger(value)) out[key] = "Enter a whole number.";
    else if (value < min || value > max) out[key] = `Enter a number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`;
  }
  const [contact, alert, noShow] = [num(form.contactAfterMinutes), num(form.alertAfterMinutes), num(form.noShowAfterMinutes)];
  if (!out.alertAfterMinutes && alert < contact) out.alertAfterMinutes = "Must be the same as or later than checking on the cleaner.";
  if (!out.noShowAfterMinutes && noShow < alert) out.noShowAfterMinutes = "Must be the same as or later than alerting you.";
  return out;
}

function Checkbox({ checked, disabled, onChange, title, detail }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void; title: string; detail: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-strong sm:col-span-2">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}

function DispatchForm({ settings, policy, canEdit }: { settings: Settings; policy: Policy; canEdit: boolean }) {
  const { companyId } = useCompany();
  const saveSettings = useMutation(api.dispatch.setSettings);
  const savePolicy = useMutation(api.dispatchOps.setPolicy);
  const saved = useMemo(() => formFrom(settings, policy), [settings, policy]);
  const { value: form, dirty, stale, change, reset } = useSavedDraft(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedWarning(dirty);
  if (!form) return null;
  const errors = canEdit ? fieldErrors(form) : {};
  const set = (patch: Partial<Form>) => {
    setNotice(null);
    change((current) => ({ ...current, ...patch }));
  };
  const field = (key: NumberKey) => (
    <Field key={key} label={FIELDS[key].label} hint={FIELDS[key].hint} error={errors[key]}>
      <TextInput inputMode="numeric" value={form[key]} disabled={!canEdit} onChange={(event) => set({ [key]: event.target.value } as Partial<Form>)} className="max-w-[10rem]" />
    </Field>
  );
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const settingsChanged = SETTING_NUMBERS.some((key) => form[key] !== saved[key]);
      const policyChanged = form.broadcastEnabled !== saved.broadcastEnabled || form.sendBeforePhotoLink !== saved.sendBeforePhotoLink || POLICY_NUMBERS.some((key) => form[key] !== saved[key]);
      if (settingsChanged) await saveSettings({ companyId, offerWindowMinutes: num(form.offerWindowMinutes), travelBufferMinutes: num(form.travelBufferMinutes), lookAheadDays: num(form.lookAheadDays) });
      if (policyChanged)
        await savePolicy({
          companyId,
          policy: { broadcastEnabled: form.broadcastEnabled, sendBeforePhotoLink: form.sendBeforePhotoLink, ...(Object.fromEntries(POLICY_NUMBERS.map((key) => [key, num(form[key])])) as Record<(typeof POLICY_NUMBERS)[number], number>) },
        });
      reset();
      setNotice("Saved. Dispatch uses these rules from now on.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Panel title="Offering jobs">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("offerWindowMinutes")}
          {field("travelBufferMinutes")}
          <Checkbox
            checked={form.broadcastEnabled}
            disabled={!canEdit}
            onChange={(value) => set({ broadcastEnabled: value })}
            title="Ask several cleaners at once"
            detail="The job goes to a few cleaners together, and the first to accept gets it. Off means cleaners are asked one at a time."
          />
          {form.broadcastEnabled ? field("broadcastSize") : null}
        </div>
      </Panel>

      <Panel title="Finding replacement cleaners">
        <p className="mb-3 text-sm text-muted-foreground">When a cleaner drops a job or doesn&apos;t answer, Dispatch offers it to someone else.</p>
        <div className="grid gap-4 sm:grid-cols-2">{field("backupOfferWindowMinutes")}</div>
      </Panel>

      <Panel title="Reminders and arrival checks">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("reminderLeadMinutes")}
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-strong">If a cleaner hasn&apos;t checked in</p>
            <p className="text-xs text-muted-foreground">
              Counted from the end of the arrival window. Example: with a 9:00–9:30 window and 15, 30 and 60 below, the cleaner is checked on at 9:45, you&apos;re alerted at 10:00, and a no-show can be marked from 10:30.
            </p>
          </div>
          {field("contactAfterMinutes")}
          {field("alertAfterMinutes")}
          {field("noShowAfterMinutes")}
        </div>
      </Panel>

      <Panel title="Job photos and completion">
        <p className="mb-3 text-sm text-muted-foreground">Photos the crew must add through their job link before a job counts as complete.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("beforePhotosRequired")}
          {field("afterPhotosRequired")}
          <Checkbox
            checked={form.sendBeforePhotoLink}
            disabled={!canEdit}
            onChange={(value) => set({ sendBeforePhotoLink: value })}
            title="Text the before-photo link when the cleaner checks in"
            detail={
              <>
                Needs your business texting number.{" "}
                <Link href="/app/settings/integrations" className="font-medium text-brand-600 underline-offset-2 hover:underline">
                  Check Connected apps
                </Link>
              </>
            }
          />
        </div>
      </Panel>

      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5 [&::-webkit-details-marker]:hidden">
          Cleaner link access and planning ahead
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Less often changed</span>
        </summary>
        <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2 sm:px-5">
          {field("jobAccessGraceHours")}
          {field("lookAheadDays")}
        </div>
      </details>

      <SaveBar
        canEdit={canEdit}
        dirty={dirty}
        stale={stale}
        problems={Object.values(errors)}
        saving={saving}
        error={error}
        notice={notice}
        saveLabel="Save dispatch rules"
        onSave={() => void save()}
        onDiscard={() => {
          reset();
          setError(null);
        }}
        staleMessage="Someone else changed the dispatch rules after you started editing. Saving will replace their changes with yours. Discard to see theirs."
      />
    </div>
  );
}

function DispatchInner() {
  const { companyId, role } = useCompany();
  const settings = useQuery(api.dispatch.settings, { companyId });
  const policy = useQuery(api.dispatchOps.policy, { companyId });
  if (!settings || !policy) return <Skeleton className="h-96 rounded-2xl" />;
  return <DispatchForm settings={settings} policy={policy} canEdit={role === "owner"} />;
}

export function DispatchRules() {
  return (
    <Guard>
      <DispatchInner />
    </Guard>
  );
}
