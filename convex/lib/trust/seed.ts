/**
 * The trust record as the owner confirmed it on 2026-11-16, and the one filter that decides what of it
 * the public may see. `trust.seed` writes SEED into the record once; the website can show
 * `publicView(SEED)` when the record cannot be reached, and it is then the same as the record would say.
 *
 * Pure: no Convex or Next.js imports, so both sides can use it.
 *
 * What is NOT here as fact: where providers process data, certifications, agreements with providers,
 * how long anything is kept and how fast a request is answered. Those are unknown until someone checks
 * them, and the record says so.
 */
import { DOCUMENT_VERSIONS } from "./documents";

export type ProviderStatus = "in_use" | "connected_not_live" | "planned";
export type ClaimStatus = "implemented_verified" | "implemented_unverified" | "planned" | "external_setup" | "decision_required";
export type ClaimArea = "access" | "permissions" | "audit" | "messaging" | "links" | "encryption" | "backups" | "mfa" | "ai" | "certification" | "sale_of_data";

export type TrustSettingsData = {
  legalEntity: string;
  mailingAddress: string;
  governingPlace: string;
  contacts: { security: string; privacy: string; support: string };
  securityTxtExpiresOn: string;
  verified: { legalEntity: boolean; mailingAddress: boolean; security: boolean; privacy: boolean; support: boolean };
};

export type TrustProviderData = {
  key: string;
  name: string;
  purpose: string;
  dataHandled: string;
  locations: string | null;
  agreementRef: string | null;
  policyUrl: string | null;
  status: ProviderStatus;
  reviewStatus: "verified" | "needs_review";
  reviewedOn: string;
  publicNote?: string;
};

export type TrustClaimData = {
  key: string;
  area: ClaimArea;
  text: string;
  evidence: string;
  status: ClaimStatus;
  reviewedOn: string;
  public: boolean;
};

export type PolicyPublicationData = {
  documentId: string;
  status: "published" | "draft" | "withdrawn";
  publishedAt?: number;
  publishedBy?: string;
  approvalNote?: string;
};

export const SEED_REVIEWED_ON = "2026-11-16";
/** Midnight UTC on the day the owner approved the first versions. */
export const SEED_PUBLISHED_AT = Date.UTC(2026, 10, 16);
export const SEED_APPROVAL_NOTE = "Approved by the owner on 2026-11-16; no outside legal review.";

const settings: TrustSettingsData = {
  legalEntity: "Divine Agency LLC",
  mailingAddress: "7404 Executive Place, Lanham, MD 20706",
  governingPlace: "Maryland, United States",
  contacts: { security: "security@selestial.io", privacy: "privacy@selestial.io", support: "support@selestial.io" },
  // security.txt asks for an expiry less than a year ahead. This is Selestial's choice, renewed by staff.
  securityTxtExpiresOn: "2027-11-15",
  verified: { legalEntity: true, mailingAddress: true, security: true, privacy: true, support: true },
};

const NOT_CHECKED = { locations: null, agreementRef: null, policyUrl: null } as const;

const providers: TrustProviderData[] = [
  {
    key: "clerk",
    name: "Clerk",
    purpose: "Sign-in and accounts",
    dataHandled: "Names, email addresses and session data of people who sign in. Passwords are handled by Clerk and never reach Selestial.",
    ...NOT_CHECKED,
    status: "in_use",
    reviewStatus: "verified",
    reviewedOn: SEED_REVIEWED_ON,
  },
  {
    key: "convex",
    name: "Convex",
    purpose: "Database and file storage",
    dataHandled: "All company records (customers, properties, cleaners, jobs, messages and the event log) and photos cleaners upload.",
    ...NOT_CHECKED,
    status: "in_use",
    reviewStatus: "verified",
    reviewedOn: SEED_REVIEWED_ON,
  },
  {
    key: "vercel",
    name: "Vercel",
    purpose: "Hosting",
    dataHandled: "Requests to the website and app, including request logs.",
    ...NOT_CHECKED,
    status: "in_use",
    reviewStatus: "verified",
    reviewedOn: SEED_REVIEWED_ON,
  },
  {
    key: "resend",
    name: "Resend",
    purpose: "Invitation email",
    dataHandled: "The invited person's email address, the company's name and the name of the person who invited them.",
    ...NOT_CHECKED,
    status: "connected_not_live",
    reviewStatus: "verified",
    reviewedOn: SEED_REVIEWED_ON,
    publicNote: "Built in, and used only once email sending is turned on.",
  },
  {
    key: "telnyx",
    name: "Telnyx",
    purpose: "Text messages to cleaners",
    dataHandled: "Cleaners' phone numbers and the text of messages to them.",
    ...NOT_CHECKED,
    status: "planned",
    reviewStatus: "needs_review",
    reviewedOn: SEED_REVIEWED_ON,
    publicNote: "Planned. Not connected: no texts are sent yet.",
  },
  {
    key: "vercel-analytics",
    name: "Vercel Analytics",
    purpose: "Website visit counts",
    dataHandled: "Pages visited and general device information.",
    ...NOT_CHECKED,
    status: "planned",
    reviewStatus: "needs_review",
    reviewedOn: SEED_REVIEWED_ON,
    publicNote: "Planned. Not loaded on the site yet.",
  },
  {
    key: "google-analytics-4",
    name: "Google Analytics 4",
    purpose: "Website analytics",
    dataHandled: "Pages visited, device and browser information, and cookie identifiers.",
    ...NOT_CHECKED,
    status: "planned",
    reviewStatus: "needs_review",
    reviewedOn: SEED_REVIEWED_ON,
    publicNote: "Planned. Not loaded on the site yet.",
  },
  {
    key: "google-ads",
    name: "Google Ads",
    purpose: "Advertising measurement",
    dataHandled: "Ad clicks, conversions and cookie identifiers.",
    ...NOT_CHECKED,
    status: "planned",
    reviewStatus: "needs_review",
    reviewedOn: SEED_REVIEWED_ON,
    publicNote: "Planned. Not loaded on the site yet.",
  },
  {
    key: "meta-pixel",
    name: "Meta Pixel",
    purpose: "Advertising measurement",
    dataHandled: "Pages visited, conversions and cookie identifiers.",
    ...NOT_CHECKED,
    status: "planned",
    reviewStatus: "needs_review",
    reviewedOn: SEED_REVIEWED_ON,
    publicNote: "Planned. Not loaded on the site yet.",
  },
];

const claims: TrustClaimData[] = [
  {
    key: "permissions-per-action",
    area: "permissions",
    text: "Each agent's actions are limited to what the business owner allows, action by action: Off, Propose, Execute and report, or Execute.",
    evidence: "convex/lib/permissionCatalog.ts (levels and ceilings), convex/authority.test.ts (granular, capped levels; silence is never approval).",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: true,
  },
  {
    key: "access-company-members",
    area: "access",
    text: "Business records are available only to members of that business, and every read and write is checked on the server.",
    evidence: "convex/lib/access.ts (requireMember, owned), convex/lib/builders.ts (every public function through a builder), convex/guard.test.ts, convex/isolation.test.ts.",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: true,
  },
  {
    key: "audit-append-only",
    area: "audit",
    text: "Important actions, approvals and outcomes are recorded in a log that is only ever added to.",
    evidence: "convex/lib/events.ts (the only writer), convex/lib/guard.ts eventLogViolations and convex/guard.test.ts (no other writer, no change or removal).",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: true,
  },
  {
    key: "messaging-permission-checks",
    area: "messaging",
    text: "Texts go out only after checking the recipient's permission, opt-outs, quiet hours and the business's sender setup.",
    evidence: "convex/lib/messaging/policy.ts (checkSend), checked at queueing (convex/lib/messaging/outbox.ts) and again at sending (messaging.claim); convex/compliance.test.ts and the Dispatch tests. Texting is not live yet; the owner chose on 2026-11-16 to state it now.",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: true,
  },
  {
    key: "links-scoped",
    area: "links",
    text: "Task links sent to cleaners work only for that cleaner's assignment, expire, and stop working when the assignment ends.",
    evidence: "convex/lib/dispatch/links.ts, convex/lib/builders.ts (linkQuery, linkMutation), convex/linkAudit.test.ts (token never stored, reads change nothing, expiry, revocation, reassignment, offer link cannot do job actions, no cross-company reads, tampered signature refused).",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: true,
  },
  {
    key: "encryption",
    area: "encryption",
    text: "Data is encrypted in transit and at rest.",
    evidence: "Depends on Vercel and Convex settings and documents that nobody has reviewed for this deployment yet.",
    status: "external_setup",
    reviewedOn: SEED_REVIEWED_ON,
    public: false,
  },
  {
    key: "backups",
    area: "backups",
    text: "Company records are backed up.",
    evidence: "Backups are a Convex deployment setting. Not confirmed on the production deployment.",
    status: "external_setup",
    reviewedOn: SEED_REVIEWED_ON,
    public: false,
  },
  {
    key: "staff-mfa",
    area: "mfa",
    text: "Selestial staff accounts require multi-factor sign-in.",
    evidence: "A Clerk setting. Not confirmed on the production instance.",
    status: "external_setup",
    reviewedOn: SEED_REVIEWED_ON,
    public: false,
  },
  {
    key: "certification",
    area: "certification",
    text: "Selestial does not hold a security certification such as SOC 2 or ISO 27001.",
    evidence: "None has been obtained. Whether and how to say so in public is the owner's decision.",
    status: "decision_required",
    reviewedOn: SEED_REVIEWED_ON,
    public: false,
  },
  {
    key: "ai-no-provider",
    area: "ai",
    text: "No AI model provider is connected: Selestial's agents follow written rules, so no business data is sent to an AI model provider.",
    evidence: "package.json has no AI SDK and convex/ calls no model; the Recruiter branch uses rules only. The owner decided on 2026-11-16 to make no training promise: when a provider is connected, name it and what it receives on the Subprocessors page and in the Privacy notice.",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: false,
  },
  {
    key: "no-sale-of-data",
    area: "sale_of_data",
    text: "Selestial does not sell personal information.",
    evidence: "The owner's commitment of 2026-11-16, also in the Privacy notice (privacy-2026-11-16). No code passes personal information to anyone for payment, and advertising tools never run inside the app.",
    status: "implemented_verified",
    reviewedOn: SEED_REVIEWED_ON,
    public: true,
  },
];

const publications: PolicyPublicationData[] = DOCUMENT_VERSIONS.map((version) => ({
  documentId: version.id,
  status: "published",
  publishedAt: SEED_PUBLISHED_AT,
  publishedBy: "owner",
  approvalNote: SEED_APPROVAL_NOTE,
}));

export const SEED: { settings: TrustSettingsData; providers: TrustProviderData[]; claims: TrustClaimData[]; publications: PolicyPublicationData[] } = {
  settings,
  providers,
  claims,
  publications,
};

// ── What the public sees ──────────────────────────────────────────────────────────────────────────

export type PublicSnapshot = {
  settings: {
    legalEntity: string | null;
    mailingAddress: string | null;
    governingPlace: string;
    contacts: { security: string | null; privacy: string | null; support: string | null };
    securityTxtExpiresOn: string;
  };
  providers: { key: string; name: string; purpose: string; dataHandled: string; locations: string | null; policyUrl: string | null; status: "in_use" | "connected_not_live"; reviewedOn: string; publicNote: string | null }[];
  claims: { key: string; area: ClaimArea; text: string; reviewedOn: string }[];
  publications: { documentId: string; status: "published" | "withdrawn"; publishedAt: number | null }[];
  updatedAt: number;
};

/**
 * The only way trust data leaves for the public. Picks fields one by one, so a field added to the record
 * later stays private until it is added here. Never evidence, agreements, review state, notes, staff or
 * request data.
 */
export function publicView(input: {
  settings: TrustSettingsData;
  providers: readonly TrustProviderData[];
  claims: readonly TrustClaimData[];
  publications: readonly PolicyPublicationData[];
  updatedAt: number;
}): PublicSnapshot {
  const s = input.settings;
  const shown = <T>(value: T, ok: boolean): T | null => (ok ? value : null);
  return {
    settings: {
      legalEntity: shown(s.legalEntity, s.verified.legalEntity),
      mailingAddress: shown(s.mailingAddress, s.verified.mailingAddress),
      governingPlace: s.governingPlace,
      contacts: {
        security: shown(s.contacts.security, s.verified.security),
        privacy: shown(s.contacts.privacy, s.verified.privacy),
        support: shown(s.contacts.support, s.verified.support),
      },
      securityTxtExpiresOn: s.securityTxtExpiresOn,
    },
    providers: [...input.providers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((row): row is TrustProviderData & { status: "in_use" | "connected_not_live" } => row.status === "in_use" || row.status === "connected_not_live")
      .map((row) => ({
        key: row.key,
        name: row.name,
        purpose: row.purpose,
        dataHandled: row.dataHandled,
        locations: row.locations,
        policyUrl: row.policyUrl,
        status: row.status,
        reviewedOn: row.reviewedOn,
        publicNote: row.publicNote ?? null,
      })),
    // Both conditions, again: a claim is said in public only when it is marked public and is verified.
    claims: [...input.claims]
      .sort((a, b) => a.key.localeCompare(b.key))
      .filter((row) => row.public && row.status === "implemented_verified").map((row) => ({ key: row.key, area: row.area, text: row.text, reviewedOn: row.reviewedOn })),
    publications: input.publications
      .filter((row): row is PolicyPublicationData & { status: "published" | "withdrawn" } => row.status === "published" || row.status === "withdrawn")
      .map((row) => ({ documentId: row.documentId, status: row.status, publishedAt: row.publishedAt ?? null })),
    updatedAt: input.updatedAt,
  };
}

/** For the website when the record cannot be reached: the seed, through the same filter. */
export const SEED_PUBLIC_SNAPSHOT: PublicSnapshot = publicView({ ...SEED, updatedAt: SEED_PUBLISHED_AT });
