import type { Metadata } from "next";

import { RequestForm, type FieldSpec } from "@/components/trust/request-form";
import { EmailInstead, RequestPage } from "@/components/trust/request-page";
import { loadPublicTrust } from "@/lib/trust/public";

import { sendPrivacyRequest } from "../../trust-actions";

export const metadata: Metadata = { title: "Privacy requests", description: "Ask to see, correct or delete information, or change how you are contacted.", alternates: { canonical: "/privacy/requests" } };
export const revalidate = 300;

const FIELDS: FieldSpec[] = [
  {
    kind: "select",
    name: "subtype",
    label: "What would you like to do?",
    required: true,
    options: [
      { value: "access", label: "See the information held about me" },
      { value: "correction", label: "Correct information about me" },
      { value: "deletion", label: "Delete information about me" },
      { value: "communication_preferences", label: "Change how I am contacted" },
      { value: "other", label: "Something else" },
    ],
  },
  {
    kind: "select",
    name: "relationship",
    label: "Your relationship to Selestial",
    required: true,
    options: [
      { value: "cleaning_company_customer", label: "My cleaning company uses Selestial" },
      { value: "customer_of_a_cleaning_company", label: "I am a customer of a cleaning company" },
      { value: "cleaner", label: "I clean for a company that uses Selestial" },
      { value: "applicant", label: "I applied to a cleaning company" },
      { value: "other", label: "None of these" },
    ],
  },
  { kind: "text", name: "businessName", label: "The cleaning company's name", optionalLabel: "(not needed if you chose None of these)", hint: "This is how we find the right records.", max: 160, autoComplete: "organization" },
  { kind: "text", name: "name", label: "Your name", max: 120, autoComplete: "name" },
  { kind: "email", name: "email", label: "Your email", required: true, autoComplete: "email", hint: "We reply here, and may ask you to confirm it is you." },
  { kind: "textarea", name: "details", label: "Details", required: true, max: 4000, hint: "What you are asking for, and anything that helps us find the information, such as a phone number you were texted on." },
];

/** A privacy request is saved for a person to handle. Nothing is exported or deleted from this form on its own. */
export default async function Page() {
  const trust = await loadPublicTrust();
  return (
    <RequestPage
      trust={trust}
      eyebrow="Privacy"
      title="Privacy requests"
      lead="Ask to see, correct or delete information about you, or change how you are contacted."
      aside={
        <>
          <div>
            <h2>Who decides</h2>
            <p className="mt-1">
              If you are a customer, cleaner or applicant of a cleaning company, that company decides what happens with your information, and Selestial works for them. We pass your request to them and help them answer it. Requests about Selestial&rsquo;s own records, such as an account you hold with us, we answer ourselves.
            </p>
          </div>
          <div>
            <h2>What happens next</h2>
            <p className="mt-1">A person reads every request. We may ask you to confirm that the information is yours before anything is shared, changed or deleted. Nothing is exported or deleted automatically from this form.</p>
          </div>
          <div>
            <h2>Texts only</h2>
            <p className="mt-1">
              To stop texts from a cleaning company, reply STOP to any of them. That takes effect straight away. See <a href="/messaging">Messaging practices</a>.
            </p>
          </div>
          <EmailInstead address={trust.settings.contacts.privacy} />
          <p className="text-sm text-[#667085]">
            How we handle information is in the <a href="/privacy">Privacy notice</a>.
          </p>
        </>
      }
    >
      <h2 className="mb-5 font-heading text-xl text-[#211a35]">Send a request</h2>
      <RequestForm action={sendPrivacyRequest} fields={FIELDS} submitLabel="Send request" />
    </RequestPage>
  );
}
