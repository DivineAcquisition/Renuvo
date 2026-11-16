"use client";

import { useMutation, useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { FormError, SelectInput, useRun } from "@/components/app/form";
import { Invitations } from "@/components/app/screens/misc";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

const ROLE_WORDS: Record<string, string> = {
  owner: "Everything, including people, authority, rules and billing.",
  manager: "Operations and approvals. No people, authority or billing changes.",
  office: "Works customers, visits and tasks, and the tasks handed to a person.",
};

export function PeopleAccess() {
  const { companyId, role } = useCompany();
  const members = useQuery(api.members.list, { companyId });
  const setRole = useMutation(api.members.setRole);
  const remove = useMutation(api.members.remove);
  const { busy, error, run } = useRun();
  const owner = role === "owner";
  return (
    <div className="grid gap-5">
      <Panel title="People">
        {members ? (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-strong">{member.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {member.email}
                    {member.status === "invited" ? " · invited, not joined yet" : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {owner && member.role !== "owner" ? (
                    <>
                      <SelectInput
                        aria-label={`Role for ${member.name}`}
                        className="w-auto min-w-32 py-1.5"
                        disabled={busy}
                        value={member.role}
                        onChange={(event) => void run(() => setRole({ companyId, memberId: member.id, role: event.target.value as "manager" | "office" }))}
                      >
                        <option value="manager">Manager</option>
                        <option value="office">Office</option>
                      </SelectInput>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove ${member.name}? They lose access at once. Records they made stay.`)) void run(() => remove({ companyId, memberId: member.id }));
                        }}
                      >
                        Remove access
                      </Button>
                    </>
                  ) : (
                    <Badge variant="outline" size="sm" className="capitalize">
                      {member.role}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Skeleton className="h-16" />
        )}
        <div className="mt-2">
          <FormError message={error} />
        </div>
        {!owner ? <p className="mt-3 text-xs text-muted-foreground">Only the Owner invites people, changes roles and removes access.</p> : <p className="mt-3 text-xs text-muted-foreground">The Owner cannot be removed or demoted here.</p>}
        {owner ? <Invitations /> : null}
      </Panel>
      <Panel title="What each role can do">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {Object.entries(ROLE_WORDS).map(([name, words]) => (
            <div key={name}>
              <dt className="font-medium capitalize text-strong">{name}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{words}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
