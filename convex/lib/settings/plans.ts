/**
 * Selestial's own plans, as a catalog. This is not a subscription: nothing here charges anyone, records
 * a purchase or grants an entitlement. Checkout, usage metering and billing-provider reconciliation are
 * not built, and until they are the company has no "active plan".
 */
export const PLANS = [
  {
    id: "growth",
    name: "Growth",
    monthlyCents: 299_00,
    includes: ["All eight agents, as each is released", "Cleaner action links"],
  },
  {
    id: "scale",
    name: "Scale",
    monthlyCents: 499_00,
    includes: ["All eight agents, as each is released", "Cleaner action links", "Customer portal access, when it is available"],
  },
] as const;

/** Stated wherever the catalog is shown. */
export const BILLING_NOTES = [
  "Usage limits are not set yet. They will be measured first and disclosed before anything is sold.",
  "Subscription checkout and payment reconciliation are not built. There is nothing to buy here yet.",
  "This catalog grants no access by itself.",
] as const;
