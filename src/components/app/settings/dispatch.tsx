"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, messageOf } from "@/components/app/form";
import { CountField, Disclosure, DurationField, NumberField } from "@/components/ui/fields";
import { Guard } from "@/components/app/settings/guard";
import { SaveBar, useSavedDraft, useUnsavedWarning } from "@/components/app/settings/save-bar";
import { Panel } from "@/components/app/shell";
import { Requirement, SwitchRow } from "@/components/ui/selection";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

const POLICY_NUMBERS = ["broadcastSize", "backupOfferWindowMinutes", "reminderLeadMinutes", "contactAfterMinutes", "alertAfterMinutes", "noShowAfterMinutes", "jobAccessGraceHours", "beforePhotosRequired", "afterPhotosRequired"] as const;
const SETTING_NUMBERS = ["offerWindowMinutes", "travelBufferMinutes", "lookAheadDays"] as const;
type NumberKey = (typeof POLICY_NUMBERS)[number] | (typeof SETTING_NUMBERS)[number];

type Form = Record<NumberKey, string> & { broadcastEnabled: boolean; sendBeforePhotoLink: boolean };

/** Each number's label with its unit, what it does, and the range the server accepts. */
const FIELDS: Record<NumberKey, { label: string; hint: string; min: number; max: number; unit: "minutes" | "hours" | "days" | "cleaners" | "photos"; step?: number }> = {
  offerWindowMinutes: { label: "Time to accept a job", hint: "If a cleaner doesn't answer in time, the next cleaner is asked.", min: 15, max: 2880, unit: "minutes", step: 15 },
  travelBufferMinutes: { label: "Travel time between jobs", hint: "Kept free before a cleaner is offered their next job.", min: 0, max: 240, unit: "minutes", step: 5 },
  lookAheadDays: { label: "Plan jobs this far ahead", hint: "Jobs further out wait until they're this close.", min: 1, max: 30, unit: "days" },
  broadcastSize: { label: "Cleaners asked at once", hint: "Used only when asking several cleaners at once is on.", min: 2, max: 10, unit: "cleaners" },
  backupOfferWindowMinutes: { label: "Time to accept a replacement job", hint: "Shorter than a normal offer, because the job is soon.", min: 5, max: 240, unit: "minutes", step: 5 },
  reminderLeadMinutes: { label: "Send the job reminder before the start", hint: "For example, 120 sends it two hours before the job.", min: 15, max: 2880, unit: "minutes", step: 15 },
  contactAfterMinutes: { label: "Check on a cleaner who hasn't arrived", hint: "Counted after the arrival window. The cleaner gets a message asking where they are.", min: 0, max: 240, unit: "minutes", step: 5 },
  alertAfterMinutes: { label: "Alert you", hint: "Counted after the arrival window. You get a task to step in.", min: 0, max: 240, unit: "minutes", step: 5 },
  noShowAfterMinutes: { label: "Allow marking a no-show", hint: "Counted after the arrival window. A person decides; it's never marked automatically.", min: 5, max: 480, unit: "minutes", step: 5 },
  beforePhotosRequired: { label: "Before photos required", hint: "0 means none.", min: 0, max: 20, unit: "photos" },
  afterPhotosRequired: { label: "After photos required", hint: "0 means none.", min: 0, max: 20, unit: "photos" },
  jobAccessGraceHours: { label: "Job link keeps working after the job", hint: "So cleaners can add late photos or notes.", min: 1, max: 168, unit: "hours" },
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

/** What asking several cleaners at once does with the numbers on this form. Read from the form, so it matches what will be saved. */
function offerEffect(form: Form): string {
  const size = Number.isInteger(num(form.broadcastSize)) ? num(form.broadcastSize) : null;
  const window = Number.isInteger(num(form.offerWindowMinutes)) ? num(form.offerWindowMinutes) : null;
  if (form.broadcastEnabled) return `Dispatch offers each job to ${size ? `up to ${size}` : "a few"} cleaners together. The first to accept gets it.`;
  return `Dispatch asks one cleaner at a time.${window ? ` Each has ${window} minutes to accept before the next cleaner is asked.` : ""}`;
}

function DispatchForm({ settings, policy, canEdit }: { settings: Settings; policy: Policy; canEdit: boolean }) {
  const { companyId } = useCompany();
  const saveSettings = useMutation(api.dispatch.setSettings);
  const savePolicy = useMutation(api.dispatchOps.setPolicy);
  const saved = useMemo(() => formFrom(settings, policy), [settings, policy]);
  const { value: form, dirty, stale, change, reset } = useSavedDraft(saved);
  // Read-only: whether Dispatch's texts are covered, from the same readiness the Team page shows.
  const texts = useQuery(api.texting.agentTexting, { companyId })?.find((row) => row.agent === "dispatch");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const leaveGuard = useUnsavedWarning(dirty, undefined, "Dispatch's rules");
  if (!form) return null;
  const errors = canEdit ? fieldErrors(form) : {};
  const set = (patch: Partial<Form>) => {
    setNotice(null);
    change((current) => ({ ...current, ...patch }));
  };
  const field = (key: NumberKey) => {
    const def = FIELDS[key];
    const change = (text: string) => set({ [key]: text } as Partial<Form>);
    // What is in use now, shown only while the form holds something different, so a preview is never read as the live setting.
    const inUse = form[key] !== saved[key] ? `In use now: ${saved[key]} ${def.unit}. Takes effect after you save.` : null;
    const common = { value: form[key], onChange: change, min: def.min, max: def.max, step: def.step ?? 1, disabled: !canEdit, readOnly: !canEdit, className: "max-w-[16rem]" };
    return (
      <Field key={key} label={def.label} hint={inUse ? `${def.hint} ${inUse}` : def.hint} error={errors[key]}>
        {def.unit === "minutes" ? <DurationField {...common} stepper /> : def.unit === "cleaners" || def.unit === "photos" ? <CountField {...common} noun={def.unit === "cleaners" ? ["cleaner", "cleaners"] : ["photo", "photos"]} /> : <NumberField {...common} stepper suffix={def.unit} preview={def.unit === "hours" ? (n) => (n >= 24 ? `${n} hours = ${Math.floor(n / 24)} day${Math.floor(n / 24) === 1 ? "" : "s"}${n % 24 ? ` ${n % 24} hours` : ""}` : null) : undefined} />}
      </Field>
    );
  };
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
          <SwitchRow
            className="sm:col-span-2"
            checked={form.broadcastEnabled}
            disabled={!canEdit}
            onChange={(value) => set({ broadcastEnabled: value })}
            title="Ask several cleaners at once"
            effect="on-save"
            dirty={form.broadcastEnabled !== saved.broadcastEnabled}
            consequence={offerEffect(form)}
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
          <SwitchRow
            className="sm:col-span-2"
            checked={form.sendBeforePhotoLink}
            disabled={!canEdit}
            onChange={(value) => set({ sendBeforePhotoLink: value })}
            title="Text the before-photo link when the cleaner checks in"
            effect="on-save"
            dirty={form.sendBeforePhotoLink !== saved.sendBeforePhotoLink}
            consequence={form.sendBeforePhotoLink ? "When a cleaner checks in, Dispatch texts them the link for their before photos." : "No text is sent at check-in."}
            requirement={
              texts ? (
                <Requirement met={texts.state === "ready" || texts.state === "partly"}>
                  {texts.words}{" "}
                  {texts.state === "ready" || texts.state === "partly" ? null : (
                    <Link href="/app/texting" className="font-medium text-brand-600 underline-offset-2 hover:underline">
                      Set up business texting
                    </Link>
                  )}
                </Requirement>
              ) : (
                <Requirement>
                  Needs an approved business texting number.{" "}
                  <Link href="/app/settings/integrations" className="font-medium text-brand-600 underline-offset-2 hover:underline">
                    Check Connected apps
                  </Link>
                </Requirement>
              )
            }
          />
        </div>
      </Panel>

      <Disclosure title="Cleaner link access and planning ahead" summary="Less often changed">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("jobAccessGraceHours")}
          {field("lookAheadDays")}
        </div>
      </Disclosure>

      {leaveGuard}
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
