"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { AgentAvatar } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { DispatchSettings } from "@/components/app/dispatch-view";
import { Field, FormError, TextInput, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

type Limit = { min: number; max: number; label: string };
const NUMBERS = [
  "broadcastSize",
  "backupOfferWindowMinutes",
  "reminderLeadMinutes",
  "contactAfterMinutes",
  "alertAfterMinutes",
  "noShowAfterMinutes",
  "jobAccessGraceHours",
  "beforePhotosRequired",
  "afterPhotosRequired",
] as const;

const GROUPS: { title: string; lead?: string; keys: (typeof NUMBERS)[number][] }[] = [
  { title: "Coverage", lead: "When a visit has no cleaner.", keys: ["backupOfferWindowMinutes"] },
  { title: "The day of service", lead: "Minutes are counted from when the arrival window closes. Each wait must be at least as long as the one before: ask the cleaner, then alert the operator, then a no-show can be declared.", keys: ["reminderLeadMinutes", "contactAfterMinutes", "alertAfterMinutes", "noShowAfterMinutes", "jobAccessGraceHours"] },
  { title: "Evidence", lead: "Photos the crew must send through their link before a visit is reported complete.", keys: ["beforePhotosRequired", "afterPhotosRequired"] },
];

export function DispatchRules() {
  const { companyId, role } = useCompany();
  const policy = useQuery(api.dispatchOps.policy, { companyId });
  return (
    <div className="grid gap-5">
      <DispatchSettings />
      {policy ? <PolicyForm key={JSON.stringify([policy.broadcastEnabled, policy.sendBeforePhotoLink, ...NUMBERS.map((key) => policy[key])])} policy={policy} canEdit={role === "owner"} /> : <Skeleton className="h-64 rounded-2xl" />}
    </div>
  );
}

function PolicyForm({ policy, canEdit }: { policy: NonNullable<ReturnType<typeof useQuery<typeof api.dispatchOps.policy>>>; canEdit: boolean }) {
  const { companyId } = useCompany();
  const setPolicy = useMutation(api.dispatchOps.setPolicy);
  const { busy, error, run } = useRun();
  const limits = policy.limits as Record<(typeof NUMBERS)[number], Limit>;
  const [form, setForm] = useState({
    broadcastEnabled: policy.broadcastEnabled,
    sendBeforePhotoLink: policy.sendBeforePhotoLink,
    ...(Object.fromEntries(NUMBERS.map((key) => [key, String(policy[key])])) as Record<(typeof NUMBERS)[number], string>),
  });
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<typeof form>) => {
    setSaved(false);
    setForm((current) => ({ ...current, ...patch }));
  };
  const field = (key: (typeof NUMBERS)[number]) => (
    <Field key={key} label={limits[key].label} hint={`${limits[key].min} to ${limits[key].max}`}>
      <TextInput inputMode="numeric" value={form[key]} disabled={!canEdit} onChange={(event) => change({ [key]: event.target.value })} />
    </Field>
  );
  return (
    <Panel title="Coverage, day-of and evidence" action={<AgentAvatar agent="dispatch" size="sm" />}>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await setPolicy({
              companyId,
              policy: { broadcastEnabled: form.broadcastEnabled, sendBeforePhotoLink: form.sendBeforePhotoLink, ...(Object.fromEntries(NUMBERS.map((key) => [key, form[key].trim() === "" ? Number.NaN : Number(form[key])])) as Record<(typeof NUMBERS)[number], number>) },
            });
            setSaved(true);
          });
        }}
      >
        <div>
          <h3 className="text-sm font-semibold text-strong">{GROUPS[0].title}</h3>
          <p className="text-xs text-muted-foreground">{GROUPS[0].lead}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm text-strong sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={form.broadcastEnabled} disabled={!canEdit} onChange={(event) => change({ broadcastEnabled: event.target.checked })} />
              <span>
                Ask several cleaners at once for an open place
                <span className="block text-xs text-muted-foreground">Off by default. More offers than open places go out, and the first to accept gets the place.</span>
              </span>
            </label>
            {field("broadcastSize")}
            {field("backupOfferWindowMinutes")}
          </div>
        </div>
        {GROUPS.slice(1).map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-strong">{group.title}</h3>
            <p className="text-xs text-muted-foreground">{group.lead}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {group.keys.map(field)}
              {group.title === "Evidence" ? (
                <label className="flex items-start gap-2 text-sm text-strong sm:col-span-2">
                  <input type="checkbox" className="mt-1" checked={form.sendBeforePhotoLink} disabled={!canEdit} onChange={(event) => change({ sendBeforePhotoLink: event.target.checked })} />
                  <span>
                    Text the before-photo link after check-in
                    <span className="block text-xs text-muted-foreground">Needs text messaging to be connected. See Connections.</span>
                  </span>
                </label>
              ) : null}
            </div>
          </div>
        ))}
        <div className="grid gap-2">
          <FormError message={error} />
          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="sm" loading={busy}>
                Save dispatch rules
              </Button>
              {saved ? (
                <span role="status" className="text-xs text-muted-foreground">
                  Saved.
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only the Owner changes these. You can read them.</p>
          )}
        </div>
      </form>
    </Panel>
  );
}
