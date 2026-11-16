/**
 * The named views the overview counts and the library filters share, so a count and the list behind it
 * are the same predicate and cannot disagree.
 */
import type { Doc } from "../../_generated/dataModel";
import { addDays, lifecycleStatus } from "./store";

export const VIEWS = ["drafts", "review", "signatures", "failed", "upcoming", "renewals", "missing"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  drafts: "Drafts awaiting completion",
  review: "Awaiting internal review",
  signatures: "Outstanding signatures",
  failed: "Delivery failures",
  upcoming: "Upcoming effective dates",
  renewals: "Approaching renewals and expirations",
  missing: "Missing required information",
};

export const UPCOMING_DAYS = 30;
export const RENEWAL_DAYS = 60;

export function matchesView(view: View, agreement: Doc<"agreements">, today: string, missingCount: number): boolean {
  if (agreement.archivedAt) return false;
  const l = agreement.lifecycle;
  switch (view) {
    case "drafts":
      return agreement.workflow === "draft";
    case "review":
      return agreement.workflow === "needs_review";
    case "signatures":
      return agreement.workflow === "sent" || agreement.workflow === "partially_signed";
    case "failed":
      return agreement.workflow === "delivery_failed";
    case "upcoming":
      return Boolean(l.effectiveOn && l.effectiveOn > today && l.effectiveOn <= addDays(today, UPCOMING_DAYS)) && agreement.workflow !== "draft";
    case "renewals": {
      if (lifecycleStatus(agreement, today, RENEWAL_DAYS) === "renewal_due") return true;
      const target = l.renewalOn ?? l.expiresOn;
      return Boolean(target && target >= today && target <= addDays(today, RENEWAL_DAYS) && (agreement.workflow === "signed" || agreement.provenance !== "unsigned") && !l.terminatedOn && !l.supersededBy);
    }
    case "missing":
      return missingCount > 0 && (agreement.workflow === "draft" || agreement.workflow === "needs_review");
  }
}
