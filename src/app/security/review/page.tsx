import type { Metadata } from "next";

import { RequestForm, type FieldSpec } from "@/components/trust/request-form";
import { EmailInstead, RequestPage } from "@/components/trust/request-page";
import { loadPublicTrust } from "@/lib/trust/public";

import { sendSecurityReview } from "../../trust-actions";

export const metadata: Metadata = { title: "Ask a security question", description: "Questions about how Selestial handles security and data, for companies deciding whether to use it.", alternates: { canonical: "/security/review" } };
export const revalidate = 300;

const FIELDS: FieldSpec[] = [
  { kind: "text", name: "company", label: "Your company", required: true, max: 160, autoComplete: "organization" },
  { kind: "text", name: "role", label: "Your role", required: true, max: 120, autoComplete: "organization-title" },
  { kind: "text", name: "name", label: "Your name", max: 120, autoComplete: "name" },
  { kind: "email", name: "email", label: "Your email", required: true, autoComplete: "email" },
  { kind: "textarea", name: "questions", label: "Your questions", required: true, max: 4000, rows: 7, hint: "Paste a questionnaire's questions here, or list what you need to know." },
  { kind: "textarea", name: "details", label: "Anything else", max: 4000, rows: 3 },
];

export default async function Page() {
  const trust = await loadPublicTrust();
  return (
    <RequestPage
      trust={trust}
      eyebrow="Security"
      title="Ask a security question"
      lead="For cleaning companies and their partners deciding whether Selestial fits. Ask what you need to know before you commit."
      aside={
        <>
          <div>
            <h2>How we answer</h2>
            <p className="mt-1">A person answers with what we have checked. If something is not in place or not verified yet, we say so rather than guess. Data processing terms are available on request.</p>
          </div>
          <div>
            <h2>Read first</h2>
            <p className="mt-1">
              The <a href="/security">Security overview</a> and the list of <a href="/security/subprocessors">subprocessors</a> may already answer your question.
            </p>
          </div>
          <EmailInstead address={trust.settings.contacts.security} />
        </>
      }
    >
      <h2 className="mb-5 font-heading text-xl text-[#211a35]">Send your questions</h2>
      <RequestForm action={sendSecurityReview} fields={FIELDS} submitLabel="Send questions" />
    </RequestPage>
  );
}
