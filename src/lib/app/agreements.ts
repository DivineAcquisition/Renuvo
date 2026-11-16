/**
 * How the Agreements workspace words and groups things. The facts (states, access, readiness) come from
 * Convex (convex/lib/agreements); this file only says how they are shown, so a screen never invents a
 * state of its own.
 */
export const AGREEMENTS_ROOT = "/app/agreements";

/** The workspace's navigation, in order. The overview is the item's own page. */
export const AGREEMENT_TABS = [
  { id: "overview", label: "Overview", href: AGREEMENTS_ROOT },
  { id: "all", label: "All Agreements", href: `${AGREEMENTS_ROOT}/all` },
  { id: "templates", label: "Templates", href: `${AGREEMENTS_ROOT}/templates` },
  { id: "awaiting-signatures", label: "Awaiting Signatures", href: `${AGREEMENTS_ROOT}/awaiting-signatures` },
  { id: "renewals", label: "Renewals & Changes", href: `${AGREEMENTS_ROOT}/renewals` },
  { id: "archive", label: "Archive", href: `${AGREEMENTS_ROOT}/archive` },
] as const;

export const agreementPath = (id: string) => `${AGREEMENTS_ROOT}/${id}`;
export const templatePath = (id: string) => `${AGREEMENTS_ROOT}/templates/${id}`;

export type Tone = "neutral" | "info" | "warning" | "success" | "error";

export const WORKFLOW: Record<string, { label: string; tone: Tone; meaning: string }> = {
  draft: { label: "Draft", tone: "neutral", meaning: "Being written. Nothing has been approved or sent." },
  needs_review: { label: "Needs review", tone: "info", meaning: "Waiting for a person to read and approve it." },
  approved: { label: "Approved", tone: "info", meaning: "A person approved this exact version. It has not been sent." },
  sent: { label: "Sent for signature", tone: "warning", meaning: "Handed to the signing service. Not delivered or signed until it reports so." },
  partially_signed: { label: "Partially signed", tone: "warning", meaning: "Some, not all, of the required signers have signed." },
  signed: { label: "Signed", tone: "success", meaning: "Every required signer has signed." },
  declined: { label: "Declined", tone: "error", meaning: "A signer declined." },
  withdrawn: { label: "Withdrawn", tone: "neutral", meaning: "The signature request was withdrawn." },
  expired: { label: "Signing expired", tone: "error", meaning: "The signature request ran out before everyone signed." },
  delivery_failed: { label: "Delivery failed", tone: "error", meaning: "The request or an email could not be delivered." },
};

export const LIFECYCLE: Record<string, { label: string; tone: Tone }> = {
  none: { label: "Not in force", tone: "neutral" },
  not_started: { label: "Starts later", tone: "info" },
  in_force: { label: "In force", tone: "success" },
  renewal_due: { label: "Renewal or end approaching", tone: "warning" },
  expired: { label: "Term ended", tone: "error" },
  terminated: { label: "Terminated", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

export const READINESS: Record<string, { label: string; meaning: string }> = {
  template: { label: "Available template", meaning: "A configurable starting text for common work. It is a draft, not legal advice." },
  starting_draft: { label: "Starting draft", meaning: "A configurable skeleton. Read it closely and have someone review it before use." },
  specialist_review: { label: "Needs specialist review", meaning: "Do not use without a lawyer or specialist reviewing it." },
};

export const CATEGORY: Record<string, string> = { customer: "Customer & service", workforce: "Workforce", supporting: "Supporting documents", business: "Business relationships" };

export const ACCESS: Record<string, string> = { company: "Open to everyone who works customers", workforce: "Owners and Managers", restricted: "The Owner only" };

export const PROVENANCE: Record<string, { label: string; meaning: string }> = {
  unsigned: { label: "Not signed", meaning: "No signature exists for this document." },
  provider_signed: { label: "Signed through the signing service", meaning: "The signing service reported every required signature." },
  externally_signed: { label: "Signed elsewhere, verified by a person", meaning: "Selestial did not collect these signatures. A named person recorded that they checked the signed copy." },
};

export const SIGNER: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "neutral" },
  delivered: { label: "Delivered", tone: "info" },
  viewed: { label: "Opened", tone: "info" },
  signed: { label: "Signed", tone: "success" },
  declined: { label: "Declined", tone: "error" },
  bounced: { label: "Email bounced", tone: "error" },
};

export const REQUEST: Record<string, string> = { queued: "Being handed to the signing service", sent: "With the signing service", partially_signed: "Partly signed", completed: "Completed", declined: "Declined", withdrawn: "Withdrawn", expired: "Expired", failed: "Could not be sent" };

export const WORKFLOW_ORDER = ["draft", "needs_review", "approved", "sent", "partially_signed", "signed"] as const;

export const VIEW_HINT: Record<string, string> = {
  drafts: "Still being written.",
  review: "Ready for a person to read and approve.",
  signatures: "Out with the signing service.",
  failed: "A request or email did not go through.",
  upcoming: "Signed, and starting in the next 30 days.",
  renewals: "Ending or due for a renewal decision in the next 60 days.",
  missing: "Drafts still waiting on required answers.",
};

export const SORTS = [
  { id: "updated", label: "Recently changed" },
  { id: "created", label: "Newest" },
  { id: "title", label: "Title" },
  { id: "renewal", label: "Renewal date" },
  { id: "effective", label: "Effective date" },
] as const;

export const when = (at: number | null | undefined, timezone: string) => (at ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).format(new Date(at)) : "—");

export const isoDay = (value: string | null | undefined) => {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Highlights each [[TO CONFIRM: ...]] in a document so a missing fact is never missed. */
export function splitConfirm(text: string): { text: string; missing: boolean }[] {
  const out: { text: string; missing: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[\[TO CONFIRM:\s*([^\]]+?)\s*\]\]/g)) {
    if (match.index! > last) out.push({ text: text.slice(last, match.index), missing: false });
    out.push({ text: match[1], missing: true });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), missing: false });
  return out;
}
