import type { Metadata } from "next";

import { RequestForm, type FieldSpec } from "@/components/trust/request-form";
import { EmailInstead, RequestPage } from "@/components/trust/request-page";
import { loadPublicTrust } from "@/lib/trust/public";

import { sendVulnerabilityReport } from "../../trust-actions";

export const metadata: Metadata = { title: "Report a security issue", description: "Tell Selestial about a security problem you found.", alternates: { canonical: "/security/report" } };
export const revalidate = 300;

// No business name and no marketing consent: anyone may report a problem.
const FIELDS: FieldSpec[] = [
  { kind: "text", name: "affected", label: "What is affected", required: true, max: 500, hint: "A page, address or feature." },
  { kind: "textarea", name: "details", label: "What you found", required: true, max: 4000, rows: 8, hint: "Steps to reproduce it and what an attacker could do. Please leave out anyone else's personal information." },
  {
    kind: "select",
    name: "severityGuess",
    label: "How serious you think it is",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  { kind: "text", name: "name", label: "Your name or handle", max: 120, autoComplete: "name" },
  { kind: "email", name: "email", label: "Your email", required: true, autoComplete: "email", hint: "Only to reply to you about this report." },
];

export default async function Page() {
  const trust = await loadPublicTrust();
  return (
    <RequestPage
      trust={trust}
      eyebrow="Security"
      title="Report a security issue"
      lead="If you found a way to reach data or actions you should not, tell us here. A person reads every report."
      aside={
        <>
          <div>
            <h2>Testing</h2>
            <p className="mt-1">Use your own account and test data. Do not read, change or keep other people&rsquo;s information, and stop once you have shown the problem.</p>
          </div>
          <div>
            <h2>What we do</h2>
            <p className="mt-1">
              What we commit to when you report is in the <a href="/security#report">Security overview</a>.
            </p>
          </div>
          <EmailInstead address={trust.settings.contacts.security} />
        </>
      }
    >
      <h2 className="mb-5 font-heading text-xl text-[#211a35]">Send a report</h2>
      <RequestForm action={sendVulnerabilityReport} fields={FIELDS} submitLabel="Send report" />
    </RequestPage>
  );
}
