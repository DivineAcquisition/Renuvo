"use client";

/**
 * Retention's Playbook: what it may do without asking, action by action, and the company's own rules it
 * works from. A policy the company has not written stays "not set": Retention never invents a guarantee.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { PermissionRow } from "@/components/app/screens/agent-permissions";
import { PageHeader, Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { NotConnected } from "./shared";

type Settings = FunctionReturnType<typeof api.retentionAgent.settings>;

const SECTIONS: { title: string; lead: string; keys: string[] }[] = [
  { title: "Writing to customers", lead: "Anything a customer sees starts on Ask me first.", keys: ["retention.request_feedback", "retention.send_case_message", "retention.reactivation_offer"] },
  { title: "Remedies and money", lead: "A remedy acts without asking only inside both limits, and only when its cost is known. Refunds are always the Owner's.", keys: ["retention.remedy_within_limit", "retention.refund_above_limit"] },
  { title: "Recurring service", lead: "A customer's own request from their private link. Cancelling is always recorded at once.", keys: ["retention.apply_plan_change", "retention.cancel_on_request"] },
  { title: "Work with other agents", lead: "Handing a case's work to Dispatch, Sales, Quality or Finance.", keys: ["retention.hand_off", "retention.draft_review_reply"] },
];

function Rules({ data }: { data: Settings }) {
  const { companyId } = useCompany();
  const save = useMutation(api.retentionAgent.saveSettings);
  const { busy, error, run } = useRun();
  const s = data.settings;
  const [guarantee, setGuarantee] = useState(s.guarantee?.text ?? "");
  const [days, setDays] = useState(String(s.guarantee?.days ?? 3));
  const [review, setReview] = useState(s.reviewUrl ?? "");
  const [first, setFirst] = useState(s.feedbackAfterFirstService);
  const [linkDays, setLinkDays] = useState(String(s.linkDays));
  const [due, setDue] = useState(String(s.recoveryDueHours));
  const [quiet, setQuiet] = useState(String(s.quietDays));
  const [lead, setLead] = useState(String(s.renewalLeadDays));
  const [offered, setOffered] = useState<string[]>(s.selfService);
  const [saved, setSaved] = useState(false);
  const edit = data.canEdit;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="Your service guarantee, in your words" hint={data.set.guarantee ? "Shown on a case as the company's own policy." : "Not set. Until you write one, Retention applies no guarantee and says so on each case."}>
          <TextArea rows={2} disabled={!edit} value={guarantee} onChange={(event) => setGuarantee(event.target.value)} />
        </Field>
        <Field label="Days it covers">
          <TextInput inputMode="numeric" disabled={!edit} value={days} onChange={(event) => setDays(event.target.value)} />
        </Field>
      </div>
      <Field label="Public review page" hint="Shown to everyone who gives feedback, whatever they answered. Nobody is steered to or away from it.">
        <TextInput type="url" placeholder="https://" disabled={!edit} value={review} onChange={(event) => setReview(event.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" className="mt-1" disabled={!edit} checked={first} onChange={(event) => setFirst(event.target.checked)} />
        <span>Ask for feedback after a customer&rsquo;s first completed and reviewed service. Later visits are asked only when a person chooses to.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Days a customer link stays open">
          <TextInput inputMode="numeric" disabled={!edit} value={linkDays} onChange={(event) => setLinkDays(event.target.value)} />
        </Field>
        <Field label="Hours to act on a concern">
          <TextInput inputMode="numeric" disabled={!edit} value={due} onChange={(event) => setDue(event.target.value)} />
        </Field>
        <Field label="Days to wait for a customer">
          <TextInput inputMode="numeric" disabled={!edit} value={quiet} onChange={(event) => setQuiet(event.target.value)} />
        </Field>
        <Field label="Days before a renewal">
          <TextInput inputMode="numeric" disabled={!edit} value={lead} onChange={(event) => setLead(event.target.value)} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-strong">What a customer may ask for from their plan link</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {data.changes.map((change) => (
            <label key={change.id} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" disabled={!edit || change.id === "end_service"} checked={offered.includes(change.id) || change.id === "end_service"} onChange={(event) => setOffered((list) => (event.target.checked ? [...list, change.id] : list.filter((id) => id !== change.id)))} />
              {change.words}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Ending service is always offered. Cancelling stays as easy to reach as every other choice.</p>
      </fieldset>
      {edit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await save({
                  companyId,
                  settings: { feedbackAfterFirstService: first, linkDays: Number(linkDays), recoveryDueHours: Number(due), quietDays: Number(quiet), renewalLeadDays: Number(lead), selfService: offered as never, ...(guarantee.trim() ? { guarantee: { text: guarantee, days: Number(days) } } : {}), ...(review.trim() ? { reviewUrl: review } : {}) },
                  clear: [...(guarantee.trim() ? [] : (["guarantee"] as const)), ...(review.trim() ? [] : (["reviewUrl"] as const))],
                });
                setSaved(true);
              })
            }
          >
            Save
          </Button>
          {saved ? <span className="text-sm text-muted-foreground" role="status">Saved.</span> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the Owner changes these.</p>
      )}
      <FormError message={error} />
    </div>
  );
}

export function RetentionPlaybookScreen() {
  const { companyId, role } = useCompany();
  const permissions = useQuery(api.permissions.list, { companyId });
  const data = useQuery(api.retentionAgent.settings, { companyId });
  return (
    <>
      <PageHeader title="Playbook" lead="How Retention works for you: what it may do without asking, and the company's own rules it follows. It uses your policies as written and invents none." />
      <div className="grid gap-5">
        {SECTIONS.map((section) => (
          <Panel key={section.title} title={section.title}>
            <p className="mb-3 text-sm text-muted-foreground">{section.lead}</p>
            {permissions ? (
              <div className="grid gap-3">
                {permissions.actions
                  .filter((action) => section.keys.includes(action.key))
                  .map((action) => (
                    <PermissionRow key={action.key} action={action} canEdit={role === "owner"} />
                  ))}
              </div>
            ) : (
              <Skeleton className="h-20 rounded-xl" />
            )}
          </Panel>
        ))}
        <Panel title="Always a person">
          <ul className="grid list-disc gap-1 pl-5 text-sm text-foreground">
            <li>Safety, damage, theft and staff-conduct concerns. Retention organises the evidence and tracks the follow-through.</li>
            <li>Anything about a cleaner&rsquo;s pay or standing. No diagnosis changes either.</li>
            <li>Changing a price, and what a customer owes. A new schedule&rsquo;s price is confirmed by a person.</li>
          </ul>
        </Panel>
        <Panel title="Your rules">{data ? <Rules data={data} /> : <Skeleton className="h-64 rounded-xl" />}</Panel>
        {data ? (
          <Panel title="Ready to work">
            <ul className="grid gap-2">
              {data.readiness.map((row) => (
                <li key={row.key} className="flex items-start gap-3 rounded-xl border border-border bg-background px-3.5 py-3">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${row.ok ? "bg-success" : "bg-muted-foreground/50"}`} />
                  <span className="text-sm">
                    <span className="font-medium text-strong">
                      {row.label}: {row.ok ? "ready" : "not set up"}
                    </span>
                    <span className="block text-xs text-muted-foreground">{row.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <NotConnected items={data.missing} />
            </div>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
