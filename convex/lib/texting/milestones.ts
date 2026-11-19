/**
 * Where a texting request stands, as six milestones an owner can follow. Each is read from what actually
 * happened on the request (a reference returned, a timestamp recorded), never estimated: no countdowns,
 * no promised dates. Buying the number, the carriers approving the registration and the number being
 * connected to it are separate milestones, because each can finish while the next is still waiting.
 */
import type { Doc } from "../../_generated/dataModel";

export const MILESTONE_KEYS = ["submitted", "business", "messaging", "purchase", "connection", "ready"] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];
export type MilestoneState = "done" | "working" | "waiting" | "needs_you" | "problem";

export type Milestone = { key: MilestoneKey; label: string; state: MilestoneState; at: number | null; next: string; ownerAction: boolean };

const LABELS: Record<MilestoneKey, string> = {
  submitted: "Submitted to Selestial",
  business: "Business verification",
  messaging: "Messaging review",
  purchase: "Number purchase",
  connection: "Number connection",
  ready: "Ready to text",
};

export function milestones(row: Doc<"textingRequests">): Milestone[] {
  const sole = row.entityType === "SOLE_PROPRIETOR";
  const legacy = row.setupId === undefined;
  const needs = row.status === "needs_you" ? row.needs : undefined;
  const ended = row.status === "rejected" || row.status === "cancelled" || row.status === "failed";
  const m = (key: MilestoneKey, state: MilestoneState, at: number | null | undefined, next: string, ownerAction = false): Milestone => ({ key, label: LABELS[key], state, at: at ?? null, next, ownerAction });

  const reviewed = row.decidedAt !== undefined && row.status !== "rejected";
  const submitted =
    row.status === "rejected"
      ? m("submitted", "problem", row.decidedAt, row.note ? `Selestial review didn't approve this request: ${row.note}` : "Selestial review didn't approve this request.")
      : row.status === "cancelled"
        ? m("submitted", "problem", row.updatedAt ?? row.requestedAt, "You withdrew this request.")
        : reviewed
          ? m("submitted", "done", row.decidedAt, "Selestial reviewed your details and filed them with the carriers.")
          : m("submitted", "working", row.requestedAt, "Selestial is reviewing your details before anything is filed or charged.");

  const brandDone = row.brandVerifiedAt !== undefined || row.campaignId !== undefined;
  const business = brandDone
    ? m("business", "done", row.brandVerifiedAt ?? row.campaignFiledAt, "The carriers verified your business.")
    : needs?.kind === "code"
      ? m("business", "needs_you", needs.at, needs.words, true)
      : needs?.kind === "correction" && !row.campaignId
        ? m("business", "needs_you", needs.at, needs.words, true)
        : row.brandId
          ? m("business", "working", row.updatedAt ?? row.lastCheckedAt, sole ? "Waiting for the carriers to confirm your identity." : "The carriers are verifying your business details.")
          : m("business", "waiting", null, "Starts after Selestial review.");

  const campaignDone = row.campaignApprovedAt !== undefined || (legacy && row.assignedAt !== undefined);
  const messaging = campaignDone
    ? m("messaging", "done", row.campaignApprovedAt ?? row.assignedAt, "The carriers approved how you'll text.")
    : needs?.kind === "correction" && row.campaignId
      ? m("messaging", "needs_you", needs.at, needs.words, true)
      : row.campaignId
        ? m("messaging", "working", row.updatedAt ?? row.campaignFiledAt, "The carriers are reviewing how you'll text. This usually takes a few business days, sometimes longer.")
        : m("messaging", "waiting", null, "Starts after your business is verified.");

  const bought = row.numberOrderedAt !== undefined || (legacy && row.brandId !== undefined);
  const purchase = bought
    ? m("purchase", "done", row.numberOrderedAt, `Your number ${row.phoneNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")} is yours.`)
    : needs?.kind === "number"
      ? m("purchase", "needs_you", needs.at, needs.words, true)
      : row.orderReference
        ? m("purchase", "working", row.updatedAt, "Buying your number.")
        : m("purchase", "waiting", null, legacy ? "Starts after Selestial review." : "Your number is bought once the carriers approve, so you never pay for a number you can't use.");

  const connected = row.status === "active" || row.status === "interrupted";
  const connection = connected
    ? m("connection", "done", row.activeAt, "Your number is connected to your approved registration.")
    : row.assignedAt !== undefined
      ? m("connection", "working", row.updatedAt ?? row.assignedAt, "The carriers are connecting your number. This can take several business days after approval, and texts wait until it's done.")
      : m("connection", "waiting", null, "Starts after your number is bought.");

  const ready =
    row.status === "active"
      ? m("ready", "done", row.activeAt, "Texts can go out from your number.")
      : row.status === "interrupted"
        ? m("ready", "problem", row.updatedAt, row.step ?? "Texting is paused. Selestial is looking into it.")
        : m("ready", "waiting", null, "Your agents start texting once every step above is done.");

  const out = [submitted, business, messaging, purchase, connection, ready];
  if (ended && row.status !== "rejected" && row.status !== "cancelled") {
    // A request Selestial could not finish: the first unfinished milestone says so, in plain words.
    const first = out.find((row) => row.state !== "done");
    if (first) Object.assign(first, { state: "problem" as const, next: row.step ?? "Selestial couldn't finish this step and is looking into it. Nothing more is charged." });
  }
  return out;
}
