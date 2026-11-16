import { FACTS, type DocumentText } from "./types";

export const PRIVACY: DocumentText = {
  versionId: "privacy-2026-11-16",
  kind: "privacy",
  lead: `This notice explains what personal information ${FACTS.product} handles, why, who else handles it, and what you can ask us to do with it. It covers our website, our sign-up and request forms, and the ${FACTS.product} service that cleaning companies use.`,
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are",
      blocks: [
        {
          p: `${FACTS.product} (at ${FACTS.site}) is an operating platform for cleaning companies in the United States and Canada. It is run by ${FACTS.entity}, ${FACTS.address}. In this notice, "we" and "us" mean ${FACTS.entity}.`,
        },
        {
          p: `${FACTS.product} is in early access and still being built. This notice describes what the service does today. Where something is not in use yet, we say so.`,
        },
      ],
    },
    {
      id: "two-roles",
      heading: "Two roles: on a business's behalf, and for ourselves",
      blocks: [
        {
          p: `Cleaning companies use ${FACTS.product} to run their work. When a cleaning company puts records into ${FACTS.product} about its customers, properties, jobs, cleaners, job applicants and messages, the cleaning company decides what is collected and why. We process those records on the company's behalf and on its instructions, as its service provider (sometimes called a processor).`,
        },
        {
          p: `For the people who sign up for ${FACTS.product} accounts, for visitors to our website, and for people who ask for early access or an assessment, we decide what is collected and why. For that information we are the business responsible (sometimes called a controller).`,
        },
        {
          p: "If you are a customer, cleaner or applicant of a cleaning company, that company's own privacy notice also applies to you, and it is the first place to take questions about its records. If you contact us instead, we send your request to that company and help it respond.",
        },
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect",
      blocks: [
        { p: "From people who create an account:" },
        {
          list: [
            "Your name and email address.",
            "Your password, which is handled by our sign-in provider, Clerk. We do not store it.",
            "The session and device information Clerk needs to keep your account secure, such as recognising a new device.",
            "Your membership of a workspace: your name, email address and role.",
            "Invitations you send or receive.",
          ],
        },
        { p: "From a cleaning company, about its business and the people it works with:" },
        {
          list: [
            "The company: its name, time zone, settings, the permissions it gives each agent, and its compliance profile (legal and trading name, address, representative, support contacts, the sender name and texting number it uses, and its quiet hours).",
            "Customers and their properties: name, contact details, notes, addresses and access notes.",
            "Cleaners: name, contact details, availability, time off, skills and areas, and pay rate. Pay is visible to the company's Owner only.",
            `Job applicants, if the company uses ${FACTS.product} for hiring: the details the company records or the applicant gives when applying.`,
            "Jobs, assignments and offers, and when each happened.",
            "Check-ins: the time, and the location only if the cleaner's phone allows it. Photos the cleaner uploads, and checklist results.",
            "Messages sent to cleaners. The private link inside a message is not stored in readable form.",
            "Tasks, approvals, and an activity log that records what was done, by whom and when. Entries in the log are added, never edited.",
            "Contact permissions and opt-outs: who agreed to what, how and when, the exact wording they were shown, and any withdrawal.",
          ],
        },
        { p: "From visitors and the forms on our website:" },
        {
          list: [
            "Early-access and assessment requests: your name, email address, company and your answers.",
            "Privacy and security requests: your contact details and what you tell us.",
            "We do not store your IP address with a form you send. We keep only a one-way hash of it, used only to slow down abuse.",
            "Our website host, Vercel, keeps standard request logs.",
          ],
        },
        {
          p: `From people who write to us: when you email [${FACTS.supportEmail}](mailto:${FACTS.supportEmail}), [${FACTS.privacyEmail}](mailto:${FACTS.privacyEmail}) or [${FACTS.securityEmail}](mailto:${FACTS.securityEmail}), we keep your email address and what you write, so we can answer and keep a record of what was asked.`,
        },
        {
          p: "From cookies and similar tools: the sign-in cookies the service needs, and, only if you allow them, analytics and advertising tools on our public pages. [Cookies and Tracking](/cookies) lists each one.",
        },
        {
          p: "The service does not ask for payment card or bank details. Notes fields accept free text, so we ask companies not to put sensitive information in them, such as health details or government identity numbers, unless the work needs it.",
        },
      ],
    },
    {
      id: "how-we-use",
      heading: "How we use it",
      blocks: [
        {
          list: [
            "To provide the service: storing a company's records, showing them to its members according to their role, and carrying out the work its agents are permitted to do.",
            "To keep the service and its users secure, and to detect and prevent abuse and fraud.",
            "To give support when you ask for it.",
            "To communicate with account holders about their account, the service and changes to these documents.",
            "To answer early-access, assessment, privacy and security requests.",
            "To improve the service, using aggregate information about how our own product is used.",
            "To meet legal obligations, and to establish or defend legal claims.",
          ],
        },
        {
          p: `We use a cleaning company's records only to provide the service to that company, on its instructions, and as this notice describes. No AI model provider is connected to ${FACTS.product} today, and no company's records are used to train any model.`,
        },
        {
          p: "Any future use of a company's records across companies would need a separately reviewed purpose, and an update to this notice, before it starts.",
        },
      ],
    },
    {
      id: "ai-and-automated-decisions",
      heading: "AI and automated decisions",
      blocks: [
        {
          p: `${FACTS.product}'s agents currently run on rules written in code. They act only within the permissions each company's Owner sets for each action. Actions a customer, cleaner or applicant would see start on Propose, which means a person approves them until the Owner chooses otherwise.`,
        },
        {
          p: "Prices and pay are computed by code from the company's own settings. Hiring decisions are not made automatically, and characteristics protected by law are not used in them.",
        },
        {
          p: "If an AI model provider is connected in future, this notice and the [Subprocessors](/security/subprocessors) page will say so.",
        },
      ],
    },
    {
      id: "sharing",
      heading: "Who we share it with",
      blocks: [
        {
          p: "We do not sell personal information. We share it only as follows.",
        },
        {
          list: [
            `Service providers that run parts of ${FACTS.product} for us. Today these are Clerk (sign-in), Convex (database and file storage for business records and cleaners' job photos) and Vercel (website hosting). Resend (email for workspace invitations) and Telnyx (text messages) are connected in code but not live yet. The [Subprocessors](/security/subprocessors) page lists each provider.`,
            "Within a cleaning company: its members see its records according to their role.",
            "Professional advisers, such as lawyers and accountants, who need it to advise us.",
            `Authorities or others, when the law requires it, or to protect the rights, safety or property of people or of ${FACTS.product}.`,
            `A buyer or successor, if ${FACTS.product}'s business is merged, sold or transferred. We will say so on this page if that happens.`,
          ],
        },
        {
          p: `${FACTS.product} does not take payments through the service today, so no payment provider receives your information.`,
        },
        {
          p: "We do not share personal information for cross-context behavioural advertising, with one exception: if you allow advertising cookies on our public website, the Google Ads conversion tag and the Meta Pixel measure visits that come from our ads. Those tags are only on our public pages. They never run in the signed-in workspace, on sign-in pages, on cleaner or applicant pages, or on our request forms. Advertising stays off unless you turn it on.",
        },
      ],
    },
    {
      id: "retention",
      heading: "How long we keep it",
      blocks: [
        {
          list: [
            "Account information: while the account exists.",
            `A company's records: while the company uses ${FACTS.product}. When a company leaves, we delete its records within 90 days.`,
            `Requests to ${FACTS.product} (privacy requests, security reports and security questions), and the records that a deletion was done: three years after the request or deletion is closed, then deleted.`,
            "Data exports: the download file is deleted 24 hours after it is ready.",
            "Opt-out records: kept, so that an opt-out is never forgotten, even after other details are deleted.",
            "The activity log: when a person's details are erased, the log keeps the record ids of what happened, without those details.",
            "Backups: managed by our database provider. They are not rewritten when one record is erased.",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      heading: "Your choices and rights",
      blocks: [
        {
          p: "Depending on where you live, you may have the right to:",
        },
        {
          list: [
            "know what personal information we hold about you and get a copy;",
            "correct information that is wrong;",
            "have information deleted;",
            "opt out of the sale or sharing of personal information. We do not sell it. To keep advertising tools off our website, use Cookie preferences in the footer, or turn on Global Privacy Control in your browser;",
            "withdraw consent you gave, such as to texts or to optional cookies. This does not undo what was done before you withdrew it;",
            "appeal if we decline your request.",
          ],
        },
        {
          p: "If you live in Canada, you may also contact the Office of the Privacy Commissioner of Canada. If you live in a US state with its own privacy law, you may have additional rights under that law.",
        },
        {
          p: "You will not be treated differently, such as by being refused the service or charged differently, for using these rights.",
        },
      ],
    },
    {
      id: "making-a-request",
      heading: "How to make a request",
      blocks: [
        {
          p: `Use the [Data requests](/privacy/requests) form, or write to [${FACTS.privacyEmail}](mailto:${FACTS.privacyEmail}).`,
        },
        {
          list: [
            "We confirm your identity before we act, by checking details against what we already hold, such as confirming an email address. We use what you give us for that check only to verify you and keep a record of the request.",
            "Someone you authorise may make a request for you. We will ask for proof of their authority, and we may ask you to confirm your identity with us directly.",
            "If your request is about a cleaning company's records, we send it to that company and help it respond, and we tell you that we have.",
            "We answer within the time the law that applies to you requires. If we need more time, we tell you.",
            "To appeal a decision, reply to our answer and ask us to look at it again. We will tell you the result, and how to contact the relevant authority if you still disagree.",
          ],
        },
      ],
    },
    {
      id: "children",
      heading: "Children",
      blocks: [
        {
          p: `${FACTS.product} is not for anyone under 18 and is not directed to children. Accounts are for adults acting for a business. If you believe a child has given us personal information through our website or an account, write to [${FACTS.privacyEmail}](mailto:${FACTS.privacyEmail}) and we will delete it. If it is in a cleaning company's records, we will tell that company.`,
        },
      ],
    },
    {
      id: "security",
      heading: "Security",
      blocks: [
        {
          p: "Every read and write of a company's records is checked on our server against the person's membership of that company. Links sent to cleaners are signed, limited and expire. The [Security Overview](/security) explains what we do, and what we do not yet claim. No system is perfectly secure.",
        },
      ],
    },
    {
      id: "international",
      heading: "Where information is processed",
      blocks: [
        {
          p: "Our providers may process personal information outside your province or state, including in the United States. If you live in Canada, your information may be stored in the United States, where it may be accessible to authorities under the laws there.",
        },
        {
          p: "The [Subprocessors](/security/subprocessors) page lists each provider. It shows where each one processes information once we have verified it.",
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes to this notice",
      blocks: [
        {
          p: "When we change this notice, we publish a new version with a new date. Earlier versions are listed on this page. We tell account holders about material changes in the product.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          p: `Privacy questions and requests: [${FACTS.privacyEmail}](mailto:${FACTS.privacyEmail}).`,
        },
        {
          p: `By post: ${FACTS.entity}, ${FACTS.address}.`,
        },
      ],
    },
  ],
};
