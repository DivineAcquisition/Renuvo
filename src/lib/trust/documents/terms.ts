import { FACTS, type DocumentText } from "./types";

export const TERMS: DocumentText = {
  versionId: "terms-2026-11-16",
  kind: "terms",
  lead: `These terms are the agreement between your business and ${FACTS.entity}, which runs ${FACTS.product}. They say who may use ${FACTS.product}, what each side is responsible for, and what happens when something goes wrong.`,
  sections: [
    {
      id: "about-these-terms",
      heading: "About these terms",
      blocks: [
        {
          p: `${FACTS.product} (at ${FACTS.site}) is an operating platform for cleaning companies. It is run by ${FACTS.entity}, ${FACTS.address}. In these terms, "${FACTS.product}", "we" and "us" mean ${FACTS.entity}. "You" means the business that signs up, and "your people" means the members you invite to its workspace.`,
        },
        {
          p: `These terms apply together with the [Privacy Notice](/privacy), the [Messaging Practices](/messaging), the [Cookies and Tracking](/cookies) page and the [Security Overview](/security). When you accept these terms, ${FACTS.product} records which version you accepted and when.`,
        },
        {
          p: `If you do not agree to these terms, do not use ${FACTS.product}.`,
        },
      ],
    },
    {
      id: "who-may-use",
      heading: `Who may use ${FACTS.product}`,
      blocks: [
        {
          p: `${FACTS.product} is for businesses, not for personal or household use. Today it is offered to cleaning companies in the United States and Canada.`,
        },
        {
          list: [
            "The person who signs up must be at least 18 years old.",
            "The person who signs up must have the authority to accept these terms for the business. By accepting them, that person confirms they do.",
            "You must give accurate information about your business and keep it up to date.",
          ],
        },
      ],
    },
    {
      id: "accounts-and-roles",
      heading: "Accounts and roles",
      blocks: [
        {
          p: `Each person signs in with their own account. Sign-in is handled by our sign-in provider, Clerk. Keep your password to yourself and tell us at [${FACTS.supportEmail}](mailto:${FACTS.supportEmail}) if you think someone else has used your account.`,
        },
        {
          p: "You are responsible for what is done through your workspace's accounts. Each workspace has three roles: Owner, Manager and Office. Some settings, and cleaners' pay, are visible to and changeable by the Owner only.",
        },
        {
          p: "The Owner decides who is invited to the workspace, which role each person has, and what each agent is allowed to do. The Owner is responsible for those choices and for what the people they invite do in the workspace. Remove a person's access when they should no longer have it.",
        },
      ],
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      blocks: [
        { p: `You must not use ${FACTS.product}, or let anyone else use it, to:` },
        {
          list: [
            "send messages that break the law, including laws on texting, calling, email and marketing;",
            "text anyone who has not given the permission the message needs, or who has opted out;",
            "use race, colour, religion, sex, sexual orientation, gender identity, national origin, age, disability, genetic information or any other characteristic protected by law in a hiring or work decision;",
            "try to reach another business's records, or any part of the service you have not been given access to;",
            "copy, reverse engineer or take apart the service, except where the law allows it despite this term;",
            "probe, overload or disrupt the service, get around its limits or security, or use automated means to access it other than as we provide;",
            "store or send content that is unlawful, that infringes someone else's rights, or that contains malicious code;",
            "pretend to be someone else, or misrepresent who is sending a message.",
          ],
        },
        {
          p: `If you find a security weakness, report it as the [Security Overview](/security) explains instead of using it.`,
        },
      ],
    },
    {
      id: "your-responsibilities",
      heading: "Your responsibilities as the sender and the business",
      blocks: [
        {
          p: `Your business is the sender of the messages it sends through ${FACTS.product}, and it is the business responsible for the records it keeps there: its customers, properties, jobs, cleaners, applicants and messages. ${FACTS.product} is the platform. In particular, you are responsible for:`,
        },
        {
          list: [
            "getting the permission each message needs before it is sent, and recording it accurately;",
            "honouring opt-outs, including ones a person makes outside the service, by recording them in the workspace;",
            "keeping the information used to register your texting with carriers accurate and current, including your legal name, address and contacts;",
            "following the employment, labour, hiring, consumer protection and privacy laws that apply to your business;",
            "having the right to put each person's information into the service and to have us process it for you;",
            "telling your cleaners what the service records about their work, including check-in times, location when their phone allows it, and the photos they upload;",
            "answering requests from people about your records. We will pass on requests that reach us and help you respond.",
          ],
        },
        {
          p: `${FACTS.product} checks every text against the permissions, opt-outs, quiet hours and limits recorded in your workspace, as the [Messaging Practices](/messaging) describe. Those checks rely on what is recorded. They help you follow the rules, but they are not legal advice and they do not make your messaging lawful on their own.`,
        },
      ],
    },
    {
      id: "agents-and-approvals",
      heading: "Agents and approvals",
      blocks: [
        {
          p: `${FACTS.product}'s agents carry out work for your business, such as offering jobs to cleaners and sending reminders. Each agent may act only within the permissions the Owner sets for each action: Off, Propose, Execute and report, or Execute. Actions that a customer, cleaner or applicant would see start on Propose, so a person approves them until the Owner chooses otherwise.`,
        },
        {
          p: "Some decisions always need a person, whatever the settings, and no agent takes them: any consequence for a cleaner, including rejecting or ending a worker; any decision that follows a background check; paying out a pay run; changing prices, pay rates or policies; and anything legal, an injury, property damage or a payment dispute.",
        },
        {
          p: "When the Owner lets an agent act without approval, or when a person approves an action an agent proposes, your business is responsible for that action as if your own staff had taken it.",
        },
        {
          p: "Prices and pay are computed by code from your business's own settings. They are never set by an AI model. Check your settings: the results are only as right as the rates and rules you enter.",
        },
        {
          p: `${FACTS.product} does not guarantee any outcome. We do not promise that a job will be booked or covered, that a cleaner will accept or arrive, that an applicant will be hired, or that any message will be delivered.`,
        },
      ],
    },
    {
      id: "early-access",
      heading: "Early access",
      blocks: [
        {
          p: `${FACTS.product} is in early access and is still being built. Features may be added, changed or removed, and some described on our website may not be available yet.`,
        },
        {
          p: "No service-level commitment is offered today. We do not promise any level of availability, response time or support hours.",
        },
        {
          p: "Parts of the service rely on other providers, such as our sign-in, database and hosting providers, listed on the [Subprocessors](/security/subprocessors) page. If a provider changes or stops a service, a feature that depends on it may change or stop too.",
        },
        {
          p: `Tell us about problems and missing features at [${FACTS.supportEmail}](mailto:${FACTS.supportEmail}). Early access works best when we hear what does not work for you.`,
        },
      ],
    },
    {
      id: "fees",
      heading: "Fees",
      blocks: [
        {
          p: `${FACTS.product} does not charge through the service today, and it does not take payments through the service.`,
        },
        {
          p: "Before any fee applies to you, we will show you the price, the billing cycle, how to cancel and the refund terms, and you will have to agree to them. No fee applies until you do.",
        },
        {
          p: "If we offer managed setup or implementation services, they are agreed separately in writing. That agreement sets their scope, who is responsible for moving records from other systems, and what support is included. We do not promise that every record, or any stored payment method, can be moved from another system.",
        },
      ],
    },
    {
      id: "your-data",
      heading: "Your data and confidentiality",
      blocks: [
        {
          p: `Your business owns the records it puts into ${FACTS.product}. You give us permission to store, process and display them only to provide the service to you, to keep it secure, and as the [Privacy Notice](/privacy) says. For those records we act on your behalf and on your instructions.`,
        },
        {
          p: "Settings includes tools to export your records and to delete them. Deletion is described in the Privacy Notice, including what is kept so that an opt-out is never forgotten.",
        },
        {
          p: `Each side will keep the other's non-public information confidential, use it only for the purposes of these terms, and share it only with people who need it for those purposes and are bound to keep it confidential. This does not cover information that is public through no fault of the receiving side, that it already had or developed on its own, or that it must disclose by law. Where the law allows, the side that must disclose will tell the other first.`,
        },
        {
          p: "If you send us suggestions or feedback, we may use them without owing you anything.",
        },
        {
          p: `${FACTS.product}, its software and its content belong to ${FACTS.entity}. These terms let you use the service while they apply. They do not transfer any ownership of it.`,
        },
      ],
    },
    {
      id: "suspension-and-termination",
      heading: "Suspension and ending",
      blocks: [
        {
          p: `You may stop using ${FACTS.product} at any time. Export what you need first.`,
        },
        {
          p: "We may suspend all or part of your access, including pausing your agents or your texting, if:",
        },
        {
          list: [
            "you break these terms, especially the acceptable use or messaging rules;",
            "your use puts other businesses, the people you message, or the service at risk;",
            "a carrier, a provider we rely on, or the law requires it.",
          ],
        },
        {
          p: "Where the law and the security of the service allow, we will tell you why and what is needed to lift a suspension. We may end these terms if a serious breach is not fixed, or if we stop offering the service.",
        },
        {
          p: "When these terms end, your right to use the service ends. Sections that by their nature should continue, such as confidentiality, disclaimers, limitation of liability, indemnity and governing law, continue.",
        },
      ],
    },
    {
      id: "disclaimers-and-liability",
      heading: "Disclaimers and limitation of liability",
      blocks: [
        {
          p: `${FACTS.product} is provided "as is" and "as available". To the extent the law allows, we disclaim all warranties that are not written in these terms, including implied warranties of merchantability, fitness for a particular purpose and non-infringement. We do not promise that the service will be uninterrupted or free of errors, or that it will meet every need of your business.`,
        },
        {
          p: "To the extent the law allows, neither side is liable to the other for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, goodwill or data, even if it was told they were possible.",
        },
        {
          p: `To the extent the law allows, ${FACTS.entity}'s total liability arising out of or relating to these terms or the service is limited to the greater of the fees you paid us in the 12 months before the event that gave rise to the claim, or US$100.`,
        },
        {
          p: "Nothing in these terms limits liability that the law does not allow to be limited, or your obligations under the next section.",
        },
      ],
    },
    {
      id: "indemnity",
      heading: "Indemnity",
      blocks: [
        {
          p: `You will defend ${FACTS.entity} against claims by third parties, and pay the losses, fines and reasonable costs that result, to the extent they arise from: the messages your business sends or authorizes through ${FACTS.product}; the records you put into the service, or your right to put them there; your business's hiring and work decisions; or your breach of these terms or of the law.`,
        },
        {
          p: "We will tell you promptly about a claim covered here, let you control its defence, and give reasonable help at your cost. You will not settle a claim in a way that admits fault for us or binds us without our written agreement.",
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes to these terms",
      blocks: [
        {
          p: "When we change these terms, we publish a new version with a new date. Earlier versions are listed on this page. We tell account holders about material changes in the product before they take effect.",
        },
        {
          p: "If you keep using the service after the new version takes effect and you have been told about it, the new version applies. When we ask you to accept a new version, the version you accept is recorded. If you do not agree to a change, stop using the service.",
        },
      ],
    },
    {
      id: "law-and-contact",
      heading: "Governing law, general terms and contact",
      blocks: [
        {
          p: `These terms are governed by the laws of ${FACTS.governingPlace}, without regard to its conflict of laws rules. Any dispute arising out of or relating to these terms or the service will be heard only in the state or federal courts located in Maryland, and both sides agree to those courts' jurisdiction.`,
        },
        {
          p: "These terms, with the documents they refer to, are the whole agreement about the service, unless a separate written agreement signed by both sides says otherwise. If a part of these terms cannot be enforced, the rest still applies. Not enforcing a term is not a waiver of it. You may not transfer these terms without our written agreement; we may transfer them as part of a merger, acquisition or sale of the business. Neither side is liable for a delay caused by events beyond its reasonable control.",
        },
        {
          p: `Questions about these terms: [${FACTS.supportEmail}](mailto:${FACTS.supportEmail}). Formal notices: ${FACTS.entity}, ${FACTS.address}.`,
        },
      ],
    },
  ],
};
