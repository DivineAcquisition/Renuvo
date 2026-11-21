"use client";

/**
 * Recovery: every service concern and first-service follow-through, from the report to the outcome. A
 * short-term rental's open issue is ordered by the guest's arrival. A person can open a case from a
 * conversation, an inspection or a report, always linked to the service it is about.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/lib/app/stable-query";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CaseDrawer } from "./drawer";
import { CaseCardView, Empty, useCaseParam } from "./shared";
import { Checkbox, customerOption, SearchableSelect } from "@/components/ui/selection";

function NewCase({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (id: string) => void }) {
  const { companyId } = useCompany();
  const customers = useQuery(api.customers.list, open ? { companyId } : "skip");
  const [customerId, setCustomerId] = useState("");
  const sources = useQuery(api.retentionAgent.caseSources, customerId ? { companyId, customerId: customerId as Id<"customers"> } : "skip");
  const create = useMutation(api.retentionAgent.openCase);
  const { busy, error, run } = useRun();
  const [jobId, setJobId] = useState("");
  const [origin, setOrigin] = useState<"conversation" | "inspection" | "staff">("conversation");
  const [description, setDescription] = useState("");
  const [cleaner, setCleaner] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Open a case" description="Record what was reported, linked to the service it is about. Retention gathers that visit's record and prepares a first step for you to review.">
      <div className="grid gap-3">
        <Field label="Customer">
          <SearchableSelect value={customerId} onValueChange={(next) => (setCustomerId(next ?? ""), setJobId(""))} options={(customers ?? []).map(customerOption)} loading={customers === undefined} placeholder="Search customers by name, email or phone" />
        </Field>
        <Field label="The service this is about" hint={customerId && sources && !sources.visits.length ? "No completed visit is on record for this customer." : "A case about a visit can read its scope, checklist and photos."}>
          <SelectInput value={jobId} onChange={(event) => setJobId(event.target.value)} disabled={!sources}>
            <option value="">Not about one visit</option>
            {(sources?.visits ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="How it reached you">
          <SelectInput value={origin} onChange={(event) => setOrigin(event.target.value as typeof origin)}>
            <option value="conversation">A conversation with the customer</option>
            <option value="inspection">An inspection</option>
            <option value="staff">A report from the team</option>
          </SelectInput>
        </Field>
        <Field label="What was reported" hint="In the customer's words where you can. Name the room or task.">
          <TextArea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <Checkbox className="mt-1" checked={cleaner} onCheckedChange={(checked) => setCleaner(checked)} />
          <span>The customer asked for a different cleaner.</span>
        </label>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!customerId || !description.trim()}
            onClick={() =>
              void run(async () => {
                const result = await create({ companyId, customerId: customerId as Id<"customers">, ...(jobId ? { jobId: jobId as Id<"jobs"> } : {}), description, origin, wantsDifferentCleaner: cleaner });
                setDescription("");
                onClose();
                onOpened(result.caseId);
              })
            }
          >
            Open the case
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function RetentionRecoveryScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const { openId, open, close } = useCaseParam();
  const [adding, setAdding] = useState(false);
  const cases = useStableQuery(api.retentionAgent.cases, now ? { companyId, asOf: now, view: "recovery" } : "skip");
  const closed = useStableQuery(api.retentionAgent.cases, now ? { companyId, asOf: now, view: "closed" } : "skip");
  const done = (closed ?? []).filter((card) => card.kind === "recovery" || card.kind === "follow_through");
  return (
    <>
      <PageHeader
        title="Recovery"
        lead="Every concern has a responsible person or agent, a next step, a deadline and a completion condition. A correction that was carried out is not a recovered relationship until the customer says so."
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Open a case
          </Button>
        }
      />
      <div className="grid gap-5">
        <Panel title={`Open · ${cases?.length ?? 0}`}>
          {!cases ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : cases.length ? (
            <div className="grid gap-3">
              {cases.map((card) => (
                <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} checkInAt={card.checkInAt} />
              ))}
            </div>
          ) : (
            <Empty title="No concern is open" body="A case opens when a customer describes an issue in their feedback, texts about a problem, or a person records one here. It is always linked to the service it is about." action={<Button size="sm" variant="outline" onClick={() => setAdding(true)}>Open a case</Button>} />
          )}
        </Panel>
        <Panel title={`Closed in the last 90 days · ${done.length}`}>
          {!closed ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : done.length ? (
            <div className="grid gap-3">
              {done.map((card) => (
                <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} />
              ))}
            </div>
          ) : (
            <Empty title="Nothing has closed yet" body="Each closed case keeps its outcome as it actually was: confirmed by the customer, completed without their answer, or unknown." />
          )}
        </Panel>
      </div>
      <NewCase open={adding} onClose={() => setAdding(false)} onOpened={open} />
      <CaseDrawer id={openId} onClose={close} />
    </>
  );
}
