"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Notice, ToneBadge, WorkflowBadge } from "@/components/app/agreements/shared";
import type { Detail } from "@/components/app/agreements/types";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { isoDay, PROVENANCE, REQUEST, SIGNER, WORKFLOW, WORKFLOW_ORDER, when } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";

function Stepper({ workflow }: { workflow: string }) {
  const at = WORKFLOW_ORDER.indexOf(workflow as never);
  const off = ["declined", "withdrawn", "expired", "delivery_failed"].includes(workflow);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs" aria-label="Where this agreement is">
      {WORKFLOW_ORDER.map((step, index) => {
        const done = at > index || (workflow === "signed" && index <= at);
        const current = at === index && !off;
        return (
          <li key={step} className="flex items-center gap-1">
            <span className={cn("rounded-full border px-2.5 py-1", current ? "border-brand-500 bg-brand-500/10 font-medium text-strong" : done ? "border-success/40 bg-success/10 text-success-foreground" : "border-border text-muted-foreground")} aria-current={current ? "step" : undefined}>
              {WORKFLOW[step].label}
            </span>
            {index < WORKFLOW_ORDER.length - 1 ? <span aria-hidden className="text-muted-foreground">›</span> : null}
          </li>
        );
      })}
      {off ? <li><WorkflowBadge workflow={workflow} /></li> : null}
    </ol>
  );
}

/** Reviewing, approving, sending and following signatures, each as its own step, bound to one version. */
export function ReviewAndSignatures({ detail }: { detail: Detail }) {
  const { companyId, timezone } = useCompany();
  const id = detail.id as Id<"agreements">;
  const approve = useMutation(api.companyAgreements.approveVersion);
  const unapprove = useMutation(api.companyAgreements.unapprove);
  const review = useMutation(api.companyAgreements.submitForReview);
  const routing = useMutation(api.companyAgreements.setSecondApproval);
  const send = useMutation(api.agreementSigning.send);
  const withdraw = useMutation(api.agreementSigning.withdrawRequest);
  const replace = useMutation(api.agreementSigning.replace);
  const remind = useMutation(api.agreementSigning.remindSigners);
  const comment = useMutation(api.companyAgreements.comment);
  const resolve = useMutation(api.companyAgreements.resolveComment);
  const download = useMutation(api.agreementSigning.signedDownload);
  const retry = useMutation(api.agreementSigning.retrySigned);
  const blockers = useQuery(api.agreementSigning.blockers, { companyId, agreementId: detail.id });
  const { busy, error, run } = useRun();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("14");
  const [reason, setReason] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const caps = detail.capabilities;
  const request = detail.requests[0];
  const open = request && ["queued", "sent", "partially_signed"].includes(request.status);
  const ready = detail.readiness;
  const issues = [...ready.errors, ...(ready.missing.length ? [`Still needed: ${ready.missing.length} required answer${ready.missing.length === 1 ? "" : "s"}`] : [])];

  return (
    <div className="grid gap-4">
      <Panel>
        <Stepper workflow={detail.workflow} />
        <p className="mt-3 text-sm text-muted-foreground">{WORKFLOW[detail.workflow]?.meaning}</p>
        {detail.approvedVersion ? (
          <p className="mt-2 text-sm text-strong">
            Version {detail.approvedVersion} approved by {detail.approvedBy ?? "a team member"}
            {detail.secondApprovedBy ? ` and ${detail.secondApprovedBy}` : ""}
            {detail.approvedAt ? `, ${when(detail.approvedAt, timezone)}` : ""}. Any change to the text clears the approval.
          </p>
        ) : null}
      </Panel>

      <Panel title="Before it can be approved">
        <ul className="grid gap-1.5 text-sm">
          <Check ok={ready.errors.length === 0} text={ready.errors.length ? ready.errors.join(" ") : "No conflicts in the answers"} />
          <Check ok={ready.missing.length === 0} text={ready.missing.length ? `${ready.missing.length} required answer${ready.missing.length === 1 ? " is" : "s are"} missing` : "Every required answer is given"} />
          <Check ok={ready.skipped.length === 0} warn text={ready.skipped.length ? `${ready.skipped.length} term${ready.skipped.length === 1 ? " is" : "s are"} left to settle in review` : "No terms left open on purpose"} />
          <Check ok={ready.unresolved.length === 0} warn text={ready.unresolved.length ? `${ready.unresolved.length} TO CONFIRM item${ready.unresolved.length === 1 ? "" : "s"} in the text (these block sending, not approval)` : "No TO CONFIRM items in the text"} />
        </ul>
        {ready.warnings.length ? <Notice tone="warning" className="mt-3">{ready.warnings.join(" ")}</Notice> : null}
        <div className="mt-4 grid gap-2">
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            {caps.canEdit && detail.workflow === "draft" ? (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void run(() => review({ companyId, agreementId: id }))}>
                Send for internal review
              </Button>
            ) : null}
            {caps.canApprove && (detail.workflow === "draft" || detail.workflow === "needs_review") && detail.isCurrent ? (
              <>
                {ready.skipped.length ? (
                  <label className="flex items-center gap-1.5 text-xs text-strong">
                    <Checkbox checked={ack} onCheckedChange={(checked) => setAck(checked)} /> Approve with those terms still open
                  </label>
                ) : null}
                <Button size="sm" variant="primary" loading={busy} disabled={issues.length > 0 || (ready.skipped.length > 0 && !ack)} onClick={() => void run(async () => { const r = await approve({ companyId, agreementId: id, version: detail.currentVersion, hash: detail.version.hash, acknowledgeSkipped: ack }); setInfo(r.complete ? "Approved." : "First approval recorded. A second, different person must also approve."); })}>
                  Approve version {detail.currentVersion}
                </Button>
              </>
            ) : null}
            {caps.canApprove && (detail.workflow === "approved" || detail.workflow === "needs_review") && detail.approvedVersion ? (
              <Button size="sm" variant="ghost" onClick={() => void run(() => unapprove({ companyId, agreementId: id }))}>
                Withdraw approval
              </Button>
            ) : null}
            {info ? <span role="status" className="text-xs text-muted-foreground">{info}</span> : null}
          </div>
          {caps.canApprove && detail.workflow !== "signed" ? (
            <label className="flex flex-wrap items-center gap-2 text-sm text-strong">
              <Checkbox
               
                checked={detail.requiresSecondApproval}
                disabled={!["draft", "needs_review"].includes(detail.workflow)}
                onCheckedChange={(checked) => void run(() => routing({ companyId, agreementId: id, required: checked }))} />
              Require a second person to approve
              <ToneBadge tone="info">Expand</ToneBadge>
              {!detail.entitlements.expand.advanced_approval ? <span className="text-xs text-muted-foreground">Available on the Expand plan.</span> : null}
            </label>
          ) : null}
        </div>
      </Panel>

      <Panel title="Signing">
        {!detail.signing.configured ? <Notice tone="warning">{detail.signing.why}</Notice> : detail.signing.testMode ? <Notice tone="warning">{detail.signing.why}</Notice> : null}
        {request ? (
          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-strong">
                Request for version {request.version}: {REQUEST[request.status] ?? request.status}
              </p>
              <span className="text-xs text-muted-foreground">
                {request.hashMatchesCurrent ? "Matches the current text" : "The text has changed since this was sent"} · {open ? `expires ${when(request.expiresAt, timezone)}` : request.completedAt ? `completed ${when(request.completedAt, timezone)}` : ""}
              </span>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {request.signers.map((signer) => (
                <li key={signer.email} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-strong">{signer.order}. {signer.name}</span> <span className="text-muted-foreground">· {signer.email}</span>
                    {signer.problem ? <span className="block text-xs text-destructive-foreground">{signer.problem}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <ToneBadge tone={SIGNER[signer.status]?.tone ?? "neutral"}>{SIGNER[signer.status]?.label ?? signer.status}</ToneBadge>
                    <span className="text-xs text-muted-foreground">{signer.signedAt ? `signed ${when(signer.signedAt, timezone)}` : signer.viewedAt ? `opened ${when(signer.viewedAt, timezone)}` : signer.deliveredAt ? `delivered ${when(signer.deliveredAt, timezone)}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
            {request.problem ? <Notice tone="warning">{request.problem}</Notice> : null}
            <p className="text-xs text-muted-foreground">{request.reminders ? `${request.reminders} reminder${request.reminders === 1 ? "" : "s"} sent${request.lastReminderAt ? `, the last ${when(request.lastReminderAt, timezone)}` : ""}.` : "No reminders sent."} A sent email is not a signature; Selestial shows a signature only when the signing service reports it.</p>
            {caps.canSend && open ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => void run(async () => { const r = await remind({ companyId, agreementId: id }); setInfo(`Reminder sent to ${r.reminded} signer${r.reminded === 1 ? "" : "s"}.`); })}>
                    Remind signers
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => replace({ companyId, agreementId: id, reason: reason || undefined }))} title="Withdraws this request and sends a new one for the same approved version">
                    Replace the request
                  </Button>
                  <Button size="sm" variant="destructive-outline" disabled={busy} onClick={() => void run(() => withdraw({ companyId, agreementId: id, reason: reason || undefined }))}>
                    Withdraw
                  </Button>
                </div>
                <Field label="Reason (optional)">
                  <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
              </div>
            ) : null}
            {detail.workflow === "signed" && detail.provenance === "provider_signed" ? (
              <div className="flex flex-wrap items-center gap-2">
                {request.hasSignedFile ? (
                  <Button size="sm" variant="primary" loading={busy} onClick={() => void run(async () => { const r = await download({ companyId, agreementId: id }); window.open(r.url, "_blank", "noopener"); })}>
                    Download the signed document
                  </Button>
                ) : (
                  <>
                    <Notice tone="warning" className="flex-1">The signing service reported every signature, but the completed document has not been retrieved yet.</Notice>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => retry({ companyId, agreementId: id }))}>
                      Try again
                    </Button>
                  </>
                )}
                {request.evidence ? <span className="text-xs text-muted-foreground">Evidence offered by the service: {request.evidence}</span> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nothing has been sent for signature.</p>
        )}
        {caps.canSend && !open && !["signed"].includes(detail.workflow) ? (
          <div className="mt-4 grid gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-strong">Send for signature</h3>
            {blockers && blockers.blockers.length ? (
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {blockers.blockers.map((b) => (
                  <li key={b} className="flex gap-2"><span aria-hidden>·</span>{b}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Open for (days)">
                <TextInput inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} className="w-24" />
              </Field>
              <Button size="sm" variant="primary" loading={busy} disabled={!blockers || blockers.blockers.length > 0} onClick={() => void run(() => send({ companyId, agreementId: id, expiresInDays: Number(days) || undefined }))}>
                Send version {detail.currentVersion} for signature
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The signers sign exactly this version. If the text changes, it has to be approved and sent again.</p>
          </div>
        ) : null}
      </Panel>

      <Panel title="Where the signatures came from">
        <p className="text-sm font-medium text-strong">{PROVENANCE[detail.provenance]?.label}</p>
        <p className="text-sm text-muted-foreground">{PROVENANCE[detail.provenance]?.meaning}</p>
        {detail.externalVerification ? (
          <dl className="mt-3 grid gap-1 text-sm">
            <div><dt className="inline text-muted-foreground">Verified by </dt><dd className="inline font-medium text-strong">{detail.externalVerification.verifiedByName}</dd> <span className="text-muted-foreground">on {when(detail.externalVerification.verifiedAt, timezone)}</span></div>
            <div><dt className="inline text-muted-foreground">Signers named: </dt><dd className="inline text-strong">{detail.externalVerification.signers.join(", ")}</dd></div>
            {detail.externalVerification.signedOn ? <div><dt className="inline text-muted-foreground">Signed on: </dt><dd className="inline text-strong">{isoDay(detail.externalVerification.signedOn)}</dd></div> : null}
            <div><dt className="inline text-muted-foreground">How it was checked: </dt><dd className="inline text-strong">{detail.externalVerification.note}</dd></div>
          </dl>
        ) : null}
      </Panel>

      <Panel title="Review notes">
        <ul className="grid gap-2">
          {detail.comments.map((c) => (
            <li key={c.id} className={cn("rounded-lg border border-border px-3 py-2 text-sm", c.resolved && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-strong">{c.text}</span>
                <button type="button" className="shrink-0 text-xs text-brand-600 hover:underline" onClick={() => void run(() => resolve({ companyId, agreementId: id, commentId: c.id as Id<"agreementComments">, resolved: !c.resolved }))}>
                  {c.resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
              <span className="text-xs text-muted-foreground">{c.by}, on version {c.version}, {when(c.at, timezone)}</span>
            </li>
          ))}
        </ul>
        {detail.comments.length === 0 ? <p className="text-sm text-muted-foreground">No review notes yet.</p> : null}
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim()) void run(async () => { await comment({ companyId, agreementId: id, text: note }); setNote(""); });
          }}
        >
          <TextArea aria-label="Add a review note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="A question or a change you want, for whoever reviews this" />
          <div><Button type="submit" size="sm" variant="secondary" disabled={!note.trim()}>Add note</Button></div>
        </form>
      </Panel>

      <Lifecycle detail={detail} />
    </div>
  );
}

function Check({ ok, warn, text }: { ok: boolean; warn?: boolean; text: string }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={cn("mt-0.5 font-semibold", ok ? "text-success-foreground" : warn ? "text-warning-foreground" : "text-destructive-foreground")}>{ok ? "✓" : warn ? "!" : "✕"}</span>
      <span className="text-strong">{text}</span>
    </li>
  );
}

/** Dates, apart from workflow: whether the agreement is in force, when it renews or ends, and whether it was replaced. */
function Lifecycle({ detail }: { detail: Detail }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const change = useMutation(api.companyAgreements.changeLifecycle);
  const amend = useMutation(api.companyAgreements.amend);
  const archive = useMutation(api.companyAgreements.archiveAgreement);
  const restore = useMutation(api.companyAgreements.restoreAgreement);
  const { busy, error, run } = useRun();
  const l = detail.lifecycle;
  const [form, setForm] = useState({ effectiveOn: l.effectiveOn ?? "", renewalOn: l.renewalOn ?? "", expiresOn: l.expiresOn ?? "", terminatedOn: l.terminatedOn ?? "", terminationNote: l.terminationNote ?? "" });
  const id = detail.id as Id<"agreements">;
  const manage = detail.capabilities.manageRenewals;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Panel title="Dates and what happens next">
      <p className="mb-3 text-sm text-muted-foreground">Whether this agreement is in force is separate from whether it was signed. A signed agreement can start later, and an archived one can still carry obligations. A renewal date is a reminder for a person to decide; Selestial never renews, reprices or ends an agreement on its own.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Takes effect"><TextInput type="date" value={form.effectiveOn} disabled={!manage} onChange={set("effectiveOn")} /></Field>
        <Field label="Renewal decision by"><TextInput type="date" value={form.renewalOn} disabled={!manage} onChange={set("renewalOn")} /></Field>
        <Field label="Term ends"><TextInput type="date" value={form.expiresOn} disabled={!manage} onChange={set("expiresOn")} /></Field>
        <Field label="Terminated on"><TextInput type="date" value={form.terminatedOn} disabled={!manage} onChange={set("terminatedOn")} /></Field>
        <Field label="Termination note" className="sm:col-span-2 lg:col-span-4"><TextInput value={form.terminationNote} disabled={!manage} onChange={set("terminationNote")} /></Field>
      </div>
      <div className="mt-3 grid gap-2">
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          {manage ? (
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run(() => change({ companyId, agreementId: id, ...Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "")) }))}>
              Save dates
            </Button>
          ) : null}
          {detail.capabilities.canEdit && ["signed", "sent", "partially_signed", "approved"].includes(detail.workflow) ? (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => { const next = await amend({ companyId, agreementId: id, kind: "amendment" }); router.push(`/app/agreements/${next}`); })} title="A new draft that points back at this agreement. This one is never changed.">
                Start an amendment
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => { const next = await amend({ companyId, agreementId: id, kind: "replacement" }); router.push(`/app/agreements/${next}`); })}>
                Start a replacement or renewal
              </Button>
            </>
          ) : null}
          {detail.capabilities.archiveExport ? (
            detail.archived ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => restore({ companyId, agreementId: id }))}>Restore from the archive</Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => archive({ companyId, agreementId: id, reason: "Archived from the agreement" }))}>Archive</Button>
            )
          ) : null}
        </div>
        {detail.supersedes ? <p className="text-xs text-muted-foreground">This is an amendment or replacement of <a className="text-brand-600 underline" href={`/app/agreements/${detail.supersedes}`}>an earlier agreement</a>. That one is not changed until this one is signed and you set it as superseded.</p> : null}
      </div>
    </Panel>
  );
}
