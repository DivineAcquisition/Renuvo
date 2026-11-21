"use client";

/**
 * Step 5: everything in one place, with a way back to each part, what it costs and when, and the owner's
 * explicit authorization. Submitting sends it to Selestial review: nothing is filed with the carriers,
 * bought or charged until Selestial approves it.
 */
import { useMutation } from "convex/react";
import { useState } from "react";

import { PenLine } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import { ACTIVITIES_BY_KEY } from "./catalog";
import { formatPhone, placeName, useSetup, type StepId } from "./context";
import { Needs, Note, Section, StepHeading } from "./parts";
import { Checkbox } from "@/components/ui/selection";

export function ReviewStep() {
  const { view, go, run, companyId, locked } = useSetup();
  const submit = useMutation(api.textingSetup.submit);
  const [agreed, setAgreed] = useState(false);
  const b = view.setup.business;
  const sole = b.entityType === "SOLE_PROPRIETOR";
  const correcting = view.request?.status === "needs_you";
  const missing = [...view.issues.business.map((row) => row.words), ...view.issues.activities, ...view.issues.permission, ...view.issues.number];
  const links = view.pages.filter((row) => row.url);

  return (
    <>
      <StepHeading eyebrow="Step 5 of 6" title={correcting ? "Review your corrected details" : "Review & submit"} lead={correcting ? "Everything you filled in before is kept. Check the changes, then send them back." : "Check everything once more. You can change any part before you submit."} />

      <Summary title="Your business" step="business">
        <Row label="Name on texts" value={b.displayName} />
        {!sole ? <Row label="Legal name" value={b.legalName} /> : <Row label="Owner" value={[b.contactFirstName, b.contactLastName].filter(Boolean).join(" ")} />}
        <Row label="Kind of business" value={b.entityType ? view.catalog.entities[b.entityType as keyof typeof view.catalog.entities]?.label : undefined} />
        {!sole ? <Row label="EIN" value={view.setup.taxIdLast4 ? `••-•••${view.setup.taxIdLast4}` : undefined} /> : <Row label="Mobile for the code" value={formatPhone(b.mobilePhone)} />}
        <Row label="Address" value={[b.street, b.city, [b.state, b.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")} />
        <Row label="Website" value={b.website} />
        <Row label="Support" value={[b.supportEmail, formatPhone(b.supportPhone)].filter(Boolean).join(" · ")} />
      </Summary>

      <Summary title="What you'll send" step="activities">
        <Row label="Texts" value={view.setup.activities.map((key) => ACTIVITIES_BY_KEY[key]?.label).filter(Boolean).join(", ")} />
        <Row label="Registration" value={view.plan?.title} />
      </Summary>

      <Summary title="Permission to text" step="permission">
        <Row label="Wording" value={view.setup.drafts.sms_consent?.text} />
        {links.map((row) => (
          <Row key={row.kind} label={row.kind === "signup" ? "Sign-up page" : row.kind === "terms" ? "Texting terms" : "Privacy policy"} value={row.state === "published" ? row.url! : `${row.url} (${row.state === "drafted" ? "not published" : "needs attention"})`} />
        ))}
      </Summary>

      <Summary title="Your number" step="number">
        <Row label="Number" value={view.setup.number ? `${formatPhone(view.setup.number.phoneNumber)}${view.setup.number.locality ? `, ${placeName(view.setup.number.locality)}` : ""}` : undefined} />
      </Summary>

      <Section title="What it costs" lead="Taken from your messaging balance. Selestial's prices; carriers' own fees are included.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Charge</th>
                <th className="py-1.5 pr-3 font-medium">Amount</th>
                <th className="py-1.5 pr-3 font-medium">When it starts</th>
                <th className="py-1.5 font-medium">If the carriers say no</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {view.charges.rows.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <td className="py-2 pr-3 font-medium text-strong">{row.label}</td>
                  <td className="py-2 pr-3 text-strong tabular-nums">{row.amount}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{row.when}</td>
                  <td className="py-2 text-xs text-muted-foreground">{row.afterRejection}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!view.charges.required ? <Note>Messaging charges aren&apos;t switched on for your account yet. Your authorization is recorded now, and nothing is charged until they are.</Note> : null}
      </Section>

      <Section title="Selestial review" lead="Submitting doesn't file anything with the carriers yet.">
        <p className="text-sm text-muted-foreground">A person at Selestial checks your details first. Once they approve, Selestial files your registration with the carriers, and the carriers review it separately. You&apos;ll be told when anything needs you, and when your agents can start texting. Approval isn&apos;t guaranteed, and carriers don&apos;t give firm timelines.</p>
        {missing.length ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium text-strong">Before you can submit:</p>
            <Needs items={missing} />
          </div>
        ) : null}
        <label className="flex items-start gap-3 rounded-xl border border-border p-3.5 text-sm leading-6">
          <Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked)} className="mt-1 shrink-0" disabled={locked} />
          <span className="text-strong">{view.charges.wording}</span>
        </label>
        <div>
          <Button variant="primary" size="lg" disabled={!agreed || missing.length > 0 || locked} onClick={() => void (async () => {
            if (await run((revision) => submit({ companyId, revision, authorization: view.charges.wording }))) await go("progress");
          })()}>
            {correcting ? "Send my corrections to Selestial review" : "Submit for Selestial review"}
          </Button>
        </div>
      </Section>
    </>
  );
}

function Summary({ title, step, children }: { title: string; step: StepId; children: React.ReactNode }) {
  const { go, locked } = useSetup();
  return (
    <section className="grid gap-2 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-strong">{title}</h3>
        {!locked ? (
          <Button variant="ghost" size="sm" onClick={() => void go(step)}>
            <PenLine aria-hidden />
            Edit
          </Button>
        ) : null}
      </div>
      <dl className="grid gap-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className={value ? "break-words text-strong" : "text-warning-foreground"}>{value || "Not filled in yet"}</dd>
    </div>
  );
}
