"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { fieldClass, ReadyLine } from "./kit";

/** After a proposal is accepted: the agreement, billing, and each site's access and start, kept separate. */
export function SetupDetail({ setupId }: { setupId: Id<"serviceSetups"> }) {
  const { companyId } = useCompany();
  const data = useQuery(api.proposals.setup, { companyId, setupId });
  const prepare = useMutation(api.proposals.prepareAgreement);
  const mark = useMutation(api.proposals.markStep);
  const activate = useMutation(api.proposals.activateSite);
  const turnover = useMutation(api.proposals.scheduleTurnover);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { date: string; time: string; deadline: string }>>({});
  if (data === undefined) return <Skeleton className="h-[60vh] rounded-2xl" />;
  const { setup, agreement } = data;
  const run = (work: () => Promise<string>) => {
    setError(null);
    setDone(null);
    work()
      .then(setDone)
      .catch((caught: unknown) => setError(messageOf(caught)));
  };
  const minutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Service setup · ${data.proposal?.title ?? ""}`} lead={`Accepted version ${setup.version}${data.acceptedBy ? ` by ${data.acceptedBy.name}${data.acceptedBy.title ? `, ${data.acceptedBy.title}` : ""}` : ""}. Nothing is scheduled until each site's requirements are met.`} />
      {done ? (
        <p role="status" className="mb-3 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">
          {done}
        </p>
      ) : null}
      <FormError message={error} />
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Panel title="Agreement">
          <ul className="grid gap-2">
            <ReadyLine label="Service agreement" state={agreement?.workflow === "signed" ? "done" : agreement ? "waiting" : "waiting"} detail={agreement ? `${agreement.title}: ${agreement.workflow.replace(/_/g, " ")}` : "Prepared from the accepted terms: sites, services, rates and billing carried over."} />
            {data.acceptedBy?.signer ? <ReadyLine label="Signer" state="not_needed" detail={`${data.acceptedBy.signer.name} (${data.acceptedBy.signer.email}) signs for the client.`} /> : null}
          </ul>
          <div className="mt-3 flex gap-2">
            {!agreement ? (
              <Button size="sm" onClick={() => run(async () => (await prepare({ companyId, setupId }), "Agreement prepared. Review, approve and send it for signature."))}>
                Prepare agreement
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/app/agreements/${agreement._id}`}>Open agreement</Link>
              </Button>
            )}
          </div>
        </Panel>
        <Panel title="Billing">
          <ul className="grid gap-2">
            <ReadyLine label="Invoice terms" state={setup.billing === "done" ? "done" : "waiting"} detail={data.content ? `${data.content.terms.invoiceFrequency}${data.content.terms.netDays !== null ? `, due in ${data.content.terms.netDays} days` : ""}.` : null} />
          </ul>
          <div className="mt-3">
            <Button size="sm" variant={setup.billing === "done" ? "outline" : "primary"} onClick={() => run(async () => (await mark({ companyId, setupId, step: "billing", done: setup.billing !== "done" }), "Billing updated."))}>
              {setup.billing === "done" ? "Mark not set up" : "Billing contact and terms confirmed"}
            </Button>
          </div>
        </Panel>
      </div>
      <Panel title={setup.startTogether ? "Sites (all start together)" : "Sites (each starts when ready)"} flush>
        <ul className="divide-y divide-border">
          {data.sites.map((site) => {
            const f = form[site.key] ?? { date: "", time: "09:00", deadline: "" };
            const set = (patch: Partial<typeof f>) => setForm({ ...form, [site.key]: { ...f, ...patch } });
            return (
              <li key={site.key} className="grid gap-3 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-strong">{site.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {site.cadence ?? ""} · {site.priceCents !== null ? `${money(site.priceCents)} per ${site.perTurnover ? "turnover" : "visit"}` : ""}
                    </p>
                  </div>
                  {site.plan ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/app/agents/sales/plans/${site.plan._id}`}>Open recurring plan</Link>
                    </Button>
                  ) : null}
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  <ReadyLine label="Access" state={site.access === "done" || site.access === "not_needed" ? "done" : "waiting"} detail={site.access === "in_progress" ? "Access notes recorded; confirm with the client." : null} />
                  <ReadyLine label="Schedule" state={site.schedule === "done" ? "done" : site.ready ? "waiting" : "blocked"} detail={site.schedule === "done" ? (site.perTurnover ? "Turnovers are being booked." : "Recurring service started.") : site.blockers.join(" ") || "Ready to start."} />
                </ul>
                <div className="flex flex-wrap items-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => run(async () => (await mark({ companyId, setupId, step: "access", siteKey: site.key, done: site.access !== "done" }), "Access updated."))}>
                    {site.access === "done" ? "Access not confirmed" : "Access confirmed"}
                  </Button>
                  {!site.plan ? (
                    <>
                      <label className="grid gap-1 text-xs">
                        <span>{site.perTurnover ? "Turnover date" : "Start date"}</span>
                        <input type="date" className={fieldClass("min-h-9")} value={f.date} onChange={(e) => set({ date: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span>{site.perTurnover ? "Start after checkout" : "Arrival"}</span>
                        <input type="time" className={fieldClass("min-h-9")} value={f.time} onChange={(e) => set({ time: e.target.value })} />
                      </label>
                      {site.perTurnover ? (
                        <label className="grid gap-1 text-xs">
                          <span>Done by (check-in)</span>
                          <input type="time" className={fieldClass("min-h-9")} value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} />
                        </label>
                      ) : null}
                      <Button
                        size="sm"
                        disabled={!site.ready || !f.date}
                        onClick={() =>
                          run(async () => {
                            if (site.perTurnover) {
                              await turnover({ companyId, setupId, siteKey: site.key, date: f.date, startMinute: minutes(f.time), ...(f.deadline ? { deadlineMinute: minutes(f.deadline) } : {}) });
                              return "Turnover booked and sent to Dispatch.";
                            }
                            await activate({ companyId, setupId, siteKey: site.key, startDate: f.date, arrivalMinute: minutes(f.time) });
                            return "Service started. Visits are made ahead and sent to Dispatch.";
                          })
                        }
                      >
                        {site.perTurnover ? "Schedule a turnover" : "Start service"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
