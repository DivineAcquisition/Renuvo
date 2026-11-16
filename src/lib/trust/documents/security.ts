import { FACTS, type DocumentText } from "./types";

export const SECURITY: DocumentText = {
  versionId: "security-2026-11-16",
  kind: "security",
  lead: `How ${FACTS.product} protects the records cleaning companies keep in it, what we do not claim yet, and how to report a problem or ask for a security review.`,
  sections: [
    {
      id: "separation",
      heading: "Each company's records stay with that company",
      blocks: [
        {
          p: `Every read and every write of a company's records is checked on ${FACTS.product}'s server against the person's membership of that company. The check happens on the server, not in the browser, so it cannot be skipped by changing the page.`,
        },
        {
          p: `A record that belongs to another company answers as "not found". It does not reveal that the record exists.`,
        },
        {
          p: `${FACTS.product} staff have no access to a company's records through being staff.`,
        },
      ],
    },
    {
      id: "roles",
      heading: "Roles",
      blocks: [
        {
          p: "Each member of a workspace has one of three roles: Owner, Manager or Office. Some settings, and cleaners' pay, are visible to and changeable by the Owner only.",
        },
      ],
    },
    {
      id: "agents",
      heading: "What agents may do",
      blocks: [
        {
          p: "The Owner sets, for each action an agent can take, one of four levels:",
        },
        {
          list: [
            "Off: the agent does not take the action.",
            "Propose: the agent prepares the action and a person approves it before it happens.",
            "Execute and report: the agent takes the action and reports it.",
            "Execute: the agent takes the action.",
          ],
        },
        {
          p: "Actions a customer, cleaner or applicant would see start on Propose in every new workspace. What agents and people do is written to an activity log. Entries are added to the log and never edited.",
        },
      ],
    },
    {
      id: "links",
      heading: "Links sent to cleaners and invitations",
      blocks: [
        {
          p: "A cleaner opens their task from a link instead of signing in. Each link is:",
        },
        {
          list: [
            "random and signed;",
            "limited to one assignment and the actions allowed for it;",
            "set to expire, and revoked when the assignment ends;",
            "never stored in readable form, including in the record of the message that carried it.",
          ],
        },
        {
          p: "Opening a link changes nothing. Nothing happens until the cleaner acts.",
        },
        {
          p: "Invitations to join a workspace use signed links in the same way, and expire after 7 days.",
        },
      ],
    },
    {
      id: "sign-in",
      heading: "Sign-in",
      blocks: [
        {
          p: "Sign-in is handled by Clerk. It:",
        },
        {
          list: [
            "confirms a new account's email address with a code;",
            "enforces password rules, including refusing passwords found in known breaches;",
            "asks for a code sent by email when you sign in from a new device;",
            "asks you to confirm your password again before sensitive changes.",
          ],
        },
        {
          p: "The workspace and sign-in pages are sent with no-store caching, so browsers and shared caches do not keep copies of them. They are not indexed by search engines, and optional analytics and advertising tools never run on them.",
        },
      ],
    },
    {
      id: "not-yet-stated",
      heading: "What we do not state yet",
      blocks: [
        {
          p: "We will describe encryption, backups and our own staff access controls here once each has been checked. Until then we make no claim about them.",
        },
        {
          p: "We also make no claim here about security certifications, outside security testing, or how quickly incidents are notified.",
        },
      ],
    },
    {
      id: "providers",
      heading: "Providers",
      blocks: [
        {
          p: `${FACTS.product} runs on a small number of providers, such as Clerk for sign-in, Convex for the database and file storage, and Vercel for hosting. The [Subprocessors](/security/subprocessors) page lists each one and what it does.`,
        },
      ],
    },
    {
      id: "incidents",
      heading: "When something goes wrong",
      blocks: [
        {
          list: [
            "The person on call triages the report and decides how serious it is.",
            "We contain the problem, for example by revoking links, pausing agents or suspending access.",
            "We investigate what happened and what it affected.",
            "We notify affected customers, and authorities, when the law that applies requires it.",
          ],
        },
      ],
    },
    {
      id: "report",
      heading: "Reporting a vulnerability",
      blocks: [
        {
          p: `If you think you have found a security problem in ${FACTS.product}, use the [report form](/security/report) or write to [${FACTS.securityEmail}](mailto:${FACTS.securityEmail}). Tell us what you found, where, and how to see it.`,
        },
        {
          p: "We welcome research done in good faith. Please use only your own accounts and test data, and do not access, change or keep other people's information. In return, we will not ask you for anything more than we need to understand and fix the problem, we will keep you informed while we work on it, and we will credit you if you want to be credited.",
        },
      ],
    },
    {
      id: "review",
      heading: "Asking for a security review",
      blocks: [
        {
          p: `If your business needs to review ${FACTS.product}'s security before using it, use the [security review request](/security/review) or write to [${FACTS.securityEmail}](mailto:${FACTS.securityEmail}). We answer from what is true today, including the things this page does not yet claim.`,
        },
      ],
    },
  ],
};
