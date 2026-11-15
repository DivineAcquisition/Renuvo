"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { DispatchSettings } from "@/components/app/dispatch-view";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { WeekMeasures } from "@/components/app/overview/week-measures";
import { AgentPermissions } from "@/components/app/screens/agent-permissions";
import { NotBuilt, PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayName } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";

export function InsightsScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const week = useQuery(api.overview.week, now ? { companyId, asOf: now } : "skip");
  return (
    <>
      <PageHeader title="Reports" lead="Business results, with the comparison period and what each number leaves out. Booked revenue, completed service revenue and cash collected are kept apart." />
      {week ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {dayName(week.from, timezone)} to {dayName(week.to - 1, timezone)}, against {dayName(week.previousFrom, timezone)} to {dayName(week.from - 1, timezone)}.
          </p>
          <WeekMeasures measures={week.measures} />
        </>
      ) : (
        <Skeleton className="h-40 rounded-2xl" />
      )}
      <div className="mt-5">
        <NotBuilt
          title="Agent performance is not measured yet"
          body="Once agents have acted, this shows the work each completed without your intervention beside its escalations and the proposals you changed or skipped. Autonomy alone is not success if you have to repair the results."
        />
      </div>
    </>
  );
}

export function InboxScreen() {
  return (
    <>
      <PageHeader title="Inbox" lead="One conversation thread per person, shared by every agent, with a way for you to take over." />
      <NotBuilt
        title="Conversations are not built yet"
        body="Texting needs carrier registration for your company, which takes the longest of anything in setup. Until messages can be sent and received, nothing is shown here."
        points={["Customer and applicant conversations", "One send gate for consent, quiet hours and how often a person was contacted", "Take over a thread; the agent stops the moment you do"]}
      />
    </>
  );
}

function People() {
  const { companyId, role } = useCompany();
  const members = useQuery(api.members.list, { companyId });
  const invite = useMutation(api.members.invite);
  const [form, setForm] = useState({ name: "", email: "", role: "office" as "manager" | "office" });
  const { busy, error, run } = useRun();
  return (
    <Panel title="People">
      {members ? (
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="font-medium text-strong">{member.name}</span>
                <span className="block text-xs text-muted-foreground">{member.email}</span>
              </span>
              <span className="flex items-center gap-2">
                {member.status === "invited" ? (
                  <Badge variant="warning" size="sm">
                    Invited · not joined
                  </Badge>
                ) : null}
                <Badge variant="outline" size="sm" className="capitalize">
                  {member.role}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Skeleton className="h-16" />
      )}
      {role === "owner" ? (
        <form
          className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await invite({ companyId, ...form });
              setForm({ name: "", email: "", role: "office" });
            });
          }}
        >
          <Field label="Name">
            <TextInput value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
          </Field>
          <Field label="Role">
            <SelectInput value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "manager" | "office" }))}>
              <option value="office">Office</option>
              <option value="manager">Manager</option>
            </SelectInput>
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Invite
          </Button>
          <div className="sm:col-span-4">
            <FormError message={error} />
            <p className="text-xs text-muted-foreground">They join by signing in with this email. Managers run operations and approvals. Office works customers, visits and tasks.</p>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

function CompanyDetails() {
  const company = useCompany();
  const update = useMutation(api.companies.update);
  const [name, setName] = useState(company.name);
  const [timezone, setTimezone] = useState(company.timezone);
  const { busy, error, run } = useRun();
  const owner = company.role === "owner";
  return (
    <Panel title="Company">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => update({ companyId: company.companyId, name, timezone }));
        }}
      >
        <Field label="Name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} required disabled={!owner} />
        </Field>
        <Field label="Time zone" hint="Schedules, availability and deadlines use this clock.">
          <TextInput value={timezone} onChange={(event) => setTimezone(event.target.value)} required disabled={!owner} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={error} />
          {owner ? (
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={name === company.name && timezone === company.timezone}>
              Save
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only the Owner changes these.</p>
          )}
        </div>
      </form>
    </Panel>
  );
}

export function SettingsScreen({ extra }: { extra?: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" lead="Your company, its people, what each agent may do, and how Dispatch works." />
      <div className="grid gap-5">
        <CompanyDetails />
        <People />
        <AgentPermissions />
        <DispatchSettings />
        {extra}
        <NotBuilt title="Services, pricing, coverage and policies are not built yet" body="Before Sales and Retention act, the company's rules are saved here as values the system can enforce: services and durations, pricing and discount limits, service areas and hours, cancellation and refund policies." />
      </div>
    </>
  );
}
