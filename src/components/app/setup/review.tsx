"use client";

/**
 * Setup's last step, before the workspace opens: the first batch of real external actions, reviewed one by
 * one, and, separately, how much the chosen agent may do on its own from then on.
 *
 * The review is Sales's own first batch (ReviewQueue): each message shows who it goes to, on which channel,
 * its exact words and quote, and what sending it does, and each can be sent, edited or set aside. Every
 * message is checked again as it goes. Other agents' work waits in Approvals. Approving this batch changes
 * no permission: authority is chosen below, action by action, never past an action's own limit.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowUpRight, ShieldCheck } from "@/components/icons";
import { PermissionRow, type Action } from "@/components/app/screens/agent-permissions";
import { ReviewQueue } from "@/components/app/screens/sales-agent/review";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";

const NAMES = { sales: "Sales", dispatch: "Dispatch", recruiter: "Recruiter", retention: "Retention" } as const;
type Agent = keyof typeof NAMES;

export function BeforeStart({ agent, canEdit }: { agent: Agent | null; canEdit: boolean }) {
  const { companyId } = useCompany();
  const approvals = useQuery(api.approvals.list, canEdit ? { companyId, status: "pending" } : "skip");
  const permissions = useQuery(api.permissions.list, { companyId });
  const actions = (permissions?.actions ?? []).filter((action) => action.agent === agent) as (Action & { agent: string })[];
  const paused = agent ? (permissions?.pausedAgents ?? []).includes(agent) : false;
  // Sales items are counted in its own review above; everything else waits in Approvals.
  const elsewhere = (approvals ?? []).filter((row) => row.proposal?.kind !== "sales_action").length;

  return (
    <section className="grid gap-4" aria-labelledby="before-heading">
      <div>
        <h2 id="before-heading" className="text-base font-semibold text-strong">
          Before anything goes out
        </h2>
        <p className="text-sm text-muted-foreground">Each message below goes to a real person only if you send it. Each one is checked again as it goes: consent, quiet hours and whether it still applies.</p>
      </div>

      <ReviewQueue showEmpty={agent === "sales"} />

      {elsewhere > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3.5 py-3 text-sm">
          <span className="min-w-0 flex-1 text-strong">
            {elsewhere} {elsewhere === 1 ? "item is" : "items are"} waiting for your approval from your other agents.
          </span>
          <Button variant="outline" size="sm" render={<Link href="/app/approvals" />}>
            Review in Approvals
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}

      {agent && actions.length ? (
        <div className="grid gap-1 rounded-xl border border-border p-3.5">
          <h3 className="flex items-center gap-2 font-medium text-strong">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            How much may {NAMES[agent]} do on its own?
          </h3>
          <p className="text-sm text-muted-foreground">
            Separate from the review above: sending these messages doesn&apos;t change any of this. Everything starts at &ldquo;Ask me first&rdquo;. Some actions always need you, and an action that spends money needs limits before it can run on its own.
            {paused ? ` ${NAMES[agent]} is paused, so it does nothing until you resume it.` : ""}
          </p>
          <ul className="divide-y divide-border">
            {actions.map((action) => (
              <PermissionRow key={action.key} action={action} canEdit={canEdit} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Change any of this later in{" "}
            <Link href="/app/settings/agents" className="font-medium text-strong underline-offset-2 hover:underline">
              Settings › Agents
            </Link>
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}
