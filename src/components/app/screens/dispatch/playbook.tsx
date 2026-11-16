"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { PermissionRow, type Action } from "@/components/app/screens/agent-permissions";
import { PageHeader, Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { linkTo } from "@/lib/app/navigation-helpers";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";

type Policy = FunctionReturnType<typeof api.dispatchOps.policy>;
type Settings = FunctionReturnType<typeof api.dispatch.settings>;

const SECTIONS = [
  { id: "assignment", label: "Assignment Rules" },
  { id: "coverage", label: "Coverage & Escalations" },
  { id: "day-of", label: "Day-of Requirements" },
  { id: "communication", label: "Communication" },
  { id: "permissions", label: "Permissions" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Which Dispatch permissions each section shows next to its settings. */
const SECTION_ACTIONS: Record<SectionId, string[]> = {
  assignment: ["dispatch.request_acceptance", "dispatch.send_replacement_offer", "dispatch.override_time_between_jobs"],
  coverage: ["dispatch.run_backup_coverage", "dispatch.broadcast_offer", "dispatch.reassign_confirmed_visit", "dispatch.request_urgent_hire"],
  "day-of": ["dispatch.send_reminder", "dispatch.declare_no_show", "dispatch.close_visit"],
  communication: ["dispatch.act_on_cleaner_reply", "dispatch.notify_running_late"],
  permissions: [],
};

type NumberKey = "offerWindowMinutes" | "travelBufferMinutes" | "lookAheadDays" | "broadcastSize" | "backupOfferWindowMinutes" | "reminderLeadMinutes" | "contactAfterMinutes" | "alertAfterMinutes" | "noShowAfterMinutes" | "jobAccessGraceHours" | "beforePhotosRequired" | "afterPhotosRequired" | "leadPremiumPercent";
type Row = { key: NumberKey; label: string; unit: string; hint: string };

const ROWS: Record<Exclude<SectionId, "communication" | "permissions">, Row[]> = {
  assignment: [
    { key: "offerWindowMinutes", label: "Time a cleaner has to answer an offer", unit: "minutes", hint: "After this the offer expires and the next cleaner is asked. Never later than the visit’s start." },
    { key: "lookAheadDays", label: "How far ahead Dispatch staffs visits", unit: "days", hint: "Visits further out wait until they come into view." },
    { key: "travelBufferMinutes", label: "Time kept free between a cleaner’s visits", unit: "minutes", hint: "A fixed allowance. It is not a measured drive: travel time between properties is not looked up." },
    { key: "leadPremiumPercent", label: "Extra pay for the lead of a crew", unit: "%", hint: "On top of what the lead would otherwise get. Only on visits that need more than one cleaner." },
  ],
  coverage: [
    { key: "backupOfferWindowMinutes", label: "Time a cleaner has to answer a cover offer", unit: "minutes", hint: "When a place lost its cleaner close to the visit." },
    { key: "broadcastSize", label: "Cleaners asked at once for one open place", unit: "cleaners", hint: "Only when asking several at once is on. The first to accept gets the place; it never fills more places than are open." },
  ],
  "day-of": [
    { key: "reminderLeadMinutes", label: "When the reminder goes out", unit: "minutes before", hint: "It says when the job is. It never says the cleaner is on the way." },
    { key: "contactAfterMinutes", label: "Ask a cleaner who has not checked in", unit: "minutes after the window", hint: "Step one: a text asking them to check in, send an ETA, or say they cannot come." },
    { key: "alertAfterMinutes", label: "Alert a person", unit: "minutes after the window", hint: "Step two: a task to call the cleaner. Not a no-show yet." },
    { key: "noShowAfterMinutes", label: "A no-show can be declared", unit: "minutes after the window", hint: "Step three. Dispatch declares it only if allowed below and the cleaner was actually reached; otherwise a person confirms." },
    { key: "beforePhotosRequired", label: "Before photos required", unit: "photos", hint: "Needed before a cleaner can submit the visit as done." },
    { key: "afterPhotosRequired", label: "After photos required", unit: "photos", hint: "Needed before a cleaner can submit the visit as done." },
    { key: "jobAccessGraceHours", label: "How long a job link works after the visit ends", unit: "hours", hint: "For late photos and the completion report. Reassigning a cleaner closes their link at once." },
  ],
};

const SETTINGS_KEYS: NumberKey[] = ["offerWindowMinutes", "travelBufferMinutes", "lookAheadDays"];

function Health({ policy }: { policy: Policy }) {
  const { companyId } = useCompany();
  const readiness = useQuery(api.compliance.readiness, { companyId });
  const sms = readiness?.operations.find((operation) => operation.key === "sms");
  const settings = linkTo("settings");
  const rows = [
    {
      label: "Texting",
      state: sms === undefined ? "Checking" : sms.state === "ready" ? "Ready" : sms.label,
      ok: sms?.state === "ready",
      detail: sms && sms.state !== "ready" ? sms.blockers.map((blocker) => blocker.words).join(" ") : null,
    },
    {
      label: "Text provider",
      state: policy.messaging === null ? "Not connected: texts are recorded as not sent" : policy.messaging === "mock" ? "Test mode: texts are recorded, not delivered" : `Connected (${policy.messaging})`,
      ok: policy.messaging !== null && policy.messaging !== "mock",
      detail: null,
    },
    { label: "Cleaner links", state: policy.linksReady ? "Can be issued" : "Not set up: no link can be issued or opened", ok: policy.linksReady, detail: null },
  ];
  return (
    <Panel title="What Dispatch can reach">
      <ul className="grid gap-2 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="grid gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-strong">{row.label}</span>
              <Badge variant={row.ok ? "success" : "warning"} size="sm">
                {row.state}
              </Badge>
            </span>
            {row.detail ? <span className="text-xs leading-relaxed text-muted-foreground">{row.detail}</span> : null}
          </li>
        ))}
      </ul>
      {settings ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Texting setup is in{" "}
          <Link href={`${settings}/compliance`} className="font-medium text-brand-300 underline-offset-4 hover:underline">
            Settings
          </Link>
          .
        </p>
      ) : null}
    </Panel>
  );
}

function NumbersForm({ section, policy, settings, canEdit }: { section: Exclude<SectionId, "communication" | "permissions">; policy: Policy; settings: Settings; canEdit: boolean }) {
  const { companyId } = useCompany();
  const savePolicy = useMutation(api.dispatchOps.setPolicy);
  const saveSettings = useMutation(api.dispatch.setSettings);
  const { busy, error, run } = useRun();
  const current = (key: NumberKey) => String(SETTINGS_KEYS.includes(key) ? settings[key as "offerWindowMinutes"] : policy[key as Exclude<NumberKey, "offerWindowMinutes" | "travelBufferMinutes" | "lookAheadDays">]);
  const rows = ROWS[section];
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((row) => [row.key, current(row.key)])));
  const [toggles, setToggles] = useState({ broadcastEnabled: policy.broadcastEnabled, sendBeforePhotoLink: policy.sendBeforePhotoLink, crewPayMode: policy.crewPayMode });
  const [saved, setSaved] = useState(false);
  const changed = rows.some((row) => form[row.key] !== current(row.key)) || toggles.broadcastEnabled !== policy.broadcastEnabled || toggles.sendBeforePhotoLink !== policy.sendBeforePhotoLink || toggles.crewPayMode !== policy.crewPayMode;
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        void run(async () => {
          const settingRows = rows.filter((row) => SETTINGS_KEYS.includes(row.key));
          if (settingRows.some((row) => form[row.key] !== current(row.key))) {
            await saveSettings({
              companyId,
              offerWindowMinutes: Number(form.offerWindowMinutes ?? settings.offerWindowMinutes),
              travelBufferMinutes: Number(form.travelBufferMinutes ?? settings.travelBufferMinutes),
              lookAheadDays: Number(form.lookAheadDays ?? settings.lookAheadDays),
            });
          }
          const policyRows = rows.filter((row) => !SETTINGS_KEYS.includes(row.key) && form[row.key] !== current(row.key));
          const next: Record<string, number | boolean | string> = Object.fromEntries(policyRows.map((row) => [row.key, Number(form[row.key])]));
          if (section === "coverage" && toggles.broadcastEnabled !== policy.broadcastEnabled) next.broadcastEnabled = toggles.broadcastEnabled;
          if (section === "day-of" && toggles.sendBeforePhotoLink !== policy.sendBeforePhotoLink) next.sendBeforePhotoLink = toggles.sendBeforePhotoLink;
          if (section === "assignment" && toggles.crewPayMode !== policy.crewPayMode) next.crewPayMode = toggles.crewPayMode;
          if (Object.keys(next).length > 0) await savePolicy({ companyId, policy: next });
          setSaved(true);
        });
      }}
    >
      {section === "assignment" ? (
        <Field label="How a crew is paid" hint="For cleaners paid a share of the job. Hourly cleaners are paid for their own hours either way. Every offer states the exact amount, and a person offering by hand can enter any pay.">
          <SelectInput value={toggles.crewPayMode} disabled={!canEdit} onChange={(event) => setToggles((current) => ({ ...current, crewPayMode: event.target.value as Policy["crewPayMode"] }))}>
            <option value="share_of_whole">Each cleaner gets their share of the whole price</option>
            <option value="split_by_crew">Their share is split across the cleaners the visit needs</option>
          </SelectInput>
        </Field>
      ) : null}
      {section === "coverage" ? (
        <label className="flex items-start gap-2 text-sm text-strong">
          <input type="checkbox" disabled={!canEdit} checked={toggles.broadcastEnabled} onChange={(event) => setToggles((current) => ({ ...current, broadcastEnabled: event.target.checked }))} className="mt-1 size-4 accent-[var(--color-brand-400)]" />
          <span>
            Ask several cleaners at once for an open place
            <span className="block text-xs text-muted-foreground">Off: one offer per open place. On: Dispatch may ask up to the number below, only if its permission to broadcast allows it.</span>
          </span>
        </label>
      ) : null}
      {section === "day-of" ? (
        <label className="flex items-start gap-2 text-sm text-strong">
          <input type="checkbox" disabled={!canEdit} checked={toggles.sendBeforePhotoLink} onChange={(event) => setToggles((current) => ({ ...current, sendBeforePhotoLink: event.target.checked }))} className="mt-1 size-4 accent-[var(--color-brand-400)]" />
          <span>
            Text the photo page at check-in
            <span className="block text-xs text-muted-foreground">A second text with the before-photo page, sent once when the cleaner checks in.</span>
          </span>
        </label>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => {
          const limit = SETTINGS_KEYS.includes(row.key) ? settings.limits[row.key as "offerWindowMinutes"] : policy.limits[row.key as keyof Policy["limits"]];
          return (
            <Field key={row.key} label={row.label} hint={`${row.hint} ${limit ? `From ${limit.min} to ${limit.max}.` : ""}`}>
              <span className="flex items-center gap-2">
                <TextInput inputMode="numeric" disabled={!canEdit} value={form[row.key]} onChange={(event) => setForm((current) => ({ ...current, [row.key]: event.target.value }))} className="w-28" />
                <span className="text-xs text-muted-foreground">{row.unit}</span>
              </span>
            </Field>
          );
        })}
      </div>
      <FormError message={error} />
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!changed}>
            Save
          </Button>
          {saved && !changed ? <span className="text-xs text-success-foreground">Saved. It applies from now on; offers already out keep what they said.</span> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the Owner changes these.</p>
      )}
    </form>
  );
}

function Permissions({ keys, canEdit, all }: { keys: string[] | "all"; canEdit: boolean; all: { actions: Action[] & { agent?: string }[]; personOnly: readonly { key: string; label: string }[] } }) {
  const actions = (all.actions as (Action & { agent: string })[]).filter((action) => (keys === "all" ? action.agent === "dispatch" : keys.includes(action.key)));
  if (actions.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-strong">What Dispatch may do on its own</p>
      <p className="text-xs text-muted-foreground">Off: it does not. Propose: it prepares, you decide. Execute and report: it acts and tells you. Execute: it acts, and it is in the history.</p>
      <ul className="mt-1 divide-y divide-border">
        {actions.map((action) => (
          <PermissionRow key={action.key} action={action} canEdit={canEdit} />
        ))}
      </ul>
    </div>
  );
}

function Templates({ canEdit }: { canEdit: boolean }) {
  const { companyId } = useCompany();
  const templates = useQuery(api.dispatchOps.checklistTemplates, { companyId });
  const save = useMutation(api.dispatchOps.setChecklistTemplate);
  const retire = useMutation(api.dispatchOps.retireChecklistTemplate);
  const { busy, error, run } = useRun();
  const [editing, setEditing] = useState<{ serviceType: string; lines: string } | null>(null);
  const toLines = (items: { label: string; section?: string; requiresPhoto: boolean }[]) => items.map((item) => `${item.section ? `${item.section}: ` : ""}${item.label}${item.requiresPhoto ? " [photo]" : ""}`).join("\n");
  const fromLines = (lines: string) =>
    lines
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const requiresPhoto = /\[photo\]\s*$/i.test(line);
        const bare = line.replace(/\[photo\]\s*$/i, "").trim();
        const at = bare.indexOf(": ");
        return at > 0 ? { section: bare.slice(0, at), label: bare.slice(at + 2), requiresPhoto } : { label: bare, requiresPhoto };
      });
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-medium text-strong">Checklists by service</p>
        <p className="text-xs leading-relaxed text-muted-foreground">A new visit for a service starts with that service’s checklist. Saving a change makes a new version for visits scheduled after it; visits already scheduled keep the checklist they were given.</p>
      </div>
      {templates === undefined ? (
        <Skeleton className="h-16" />
      ) : templates.length === 0 && !editing ? (
        <p className="text-sm text-muted-foreground">No service has a checklist yet, so new visits start with none.</p>
      ) : (
        <ul className="grid gap-2">
          {templates.map((template) => (
            <li key={template.templateId} className={cn("rounded-xl border border-border bg-background px-3 py-2.5 text-sm", template.retired && "opacity-60")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="font-medium text-strong">{template.serviceType}</span>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · version {template.version} · {template.items.length} {template.items.length === 1 ? "item" : "items"}
                    {template.by ? ` · by ${template.by}` : ""}
                    {template.retired ? " · not used for new visits" : ""}
                  </span>
                </p>
                {canEdit ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="xs" onClick={() => setEditing({ serviceType: template.serviceType, lines: toLines(template.items) })}>
                      {template.retired ? "Use again, edited" : "Change"}
                    </Button>
                    {!template.retired ? (
                      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void run(() => retire({ companyId, templateId: template.templateId }))}>
                        Stop using
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <ul className="mt-1.5 grid gap-0.5 text-xs text-muted-foreground">
                {template.items.map((item, index) => (
                  <li key={index}>
                    {item.section ? <span className="text-strong">{item.section}: </span> : null}
                    {item.label}
                    {item.requiresPhoto ? " · needs a photo" : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form
          className="grid gap-3 rounded-xl border border-border bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await save({ companyId, serviceType: editing.serviceType, items: fromLines(editing.lines) });
              setEditing(null);
            });
          }}
        >
          <Field label="Service" hint="Matched to a visit’s service, ignoring capitals and spacing.">
            <TextInput value={editing.serviceType} onChange={(event) => setEditing({ ...editing, serviceType: event.target.value })} required maxLength={80} />
          </Field>
          <Field label="Items, one per line" hint="Start a line with a section and a colon to group it (Kitchen: Wipe counters). End it with [photo] when the item needs a photo.">
            <TextArea value={editing.lines} onChange={(event) => setEditing({ ...editing, lines: event.target.value })} rows={8} required />
          </Field>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save as a new version
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : canEdit ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setEditing({ serviceType: "", lines: "" })}>
            Add a checklist for a service
          </Button>
        </div>
      ) : null}
      {!editing ? <FormError message={error} /> : null}
    </div>
  );
}

function Messages() {
  const { companyId } = useCompany();
  const samples = useQuery(api.dispatchOps.messageSamples, { companyId });
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-medium text-strong">The texts cleaners receive</p>
        <p className="text-xs leading-relaxed text-muted-foreground">Worded exactly as they go out, shown here for an example visit. Each names the company and carries at most one link. They are fixed wording, kept short and factual; changing them is not built yet.</p>
      </div>
      {samples === undefined ? (
        <Skeleton className="h-32" />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {samples.map((sample) => (
            <li key={sample.purpose} className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-xs font-medium text-strong">{sample.purpose}</p>
              <p className="text-[11px] text-muted-foreground">{sample.when}</p>
              <p className="mt-1.5 rounded-lg bg-muted px-2.5 py-2 text-xs leading-relaxed text-strong">{sample.body.replace("{link}", "https://…/c/…")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Playbook: how Dispatch works for this company, in five parts. Every value is the Owner's; the Owner
 * changes them, everyone else can read them. What Dispatch can reach is shown next to the settings it
 * affects, so a setting is never read as working when the connection behind it is not.
 */
export function PlaybookScreen() {
  const { companyId, role } = useCompany();
  const policy = useQuery(api.dispatchOps.policy, { companyId });
  const settings = useQuery(api.dispatch.settings, { companyId });
  const permissions = useQuery(api.permissions.list, { companyId });
  const [section, setSection] = useState<SectionId>("assignment");
  const owner = role === "owner";
  const ready = policy && settings && permissions;

  return (
    <>
      <PageHeader title="Playbook" lead="How Dispatch works for your company: who it asks and how, what happens when a place opens, what the day of service needs, what it sends, and what it may do without you." />
      <div role="tablist" aria-label="Playbook" className="mb-4 inline-flex flex-wrap rounded-lg border border-border bg-muted p-0.5">
        {SECTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={section === option.id}
            onClick={() => setSection(option.id)}
            className={cn("rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", section === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!ready ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel>
            <div className="grid gap-6">
              {section === "assignment" || section === "coverage" || section === "day-of" ? (
                <NumbersForm key={section} section={section} policy={policy} settings={settings} canEdit={owner} />
              ) : null}
              {section === "day-of" ? <Templates canEdit={role !== "office"} /> : null}
              {section === "communication" ? <Messages /> : null}
              {section !== "permissions" ? (
                <div className="border-t border-border pt-4">
                  <Permissions keys={SECTION_ACTIONS[section]} canEdit={owner} all={permissions} />
                </div>
              ) : (
                <>
                  <Permissions keys="all" canEdit={owner} all={permissions} />
                  <div className="border-t border-border pt-4">
                    <p className="text-sm font-medium text-strong">Always a person</p>
                    <p className="text-xs text-muted-foreground">No agent can be allowed to do these, at any level.</p>
                    <ul className="mt-2 grid gap-1 text-sm text-strong">
                      {permissions.personOnly.map((entry) => (
                        <li key={entry.key}>· {entry.label}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-xs text-muted-foreground">{permissions.pausedAgents.includes("dispatch") ? "Dispatch is paused: it does nothing on its own until resumed, whatever is set here." : "Pausing Dispatch stops all of this at once, from the Dispatch overview."}</p>
                </>
              )}
              {!owner ? <p className="text-xs text-muted-foreground">Only the Owner changes the Playbook{role === "manager" ? ". Managers can change checklists" : ""}.</p> : null}
            </div>
          </Panel>
          <Health policy={policy} />
        </div>
      )}
    </>
  );
}
