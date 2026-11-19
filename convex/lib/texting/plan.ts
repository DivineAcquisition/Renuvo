/**
 * The registration a company's chosen activities need, and what it lets Selestial send.
 *
 * One number belongs to exactly one carrier campaign, so everything a company texts is filed as one
 * campaign on its one number: a single use case when every activity is the same kind, otherwise Mixed
 * with each kind as a sub use case (Mixed takes 2 to 5). Marketing can share that campaign only because
 * the sign-up wording names every kind of text, and marketing still needs its own separate permission.
 * A sole proprietor has one campaign of its own use case, one number and a lower daily limit.
 *
 * Coverage is what the sending policy enforces: an audience and category the registration was filed for.
 */
import type { Category, RecipientKind } from "../compliance/schema";
import { activityOf, chosen, type Activity, type UseCase } from "./activities";
import type { EntityType } from "./schema";

export type Coverage = { audience: RecipientKind; category: Category };

export type Plan = {
  usecase: "SOLE_PROPRIETOR" | "MIXED" | UseCase;
  subUsecases: UseCase[];
  coverage: Coverage[];
  marketing: boolean;
  title: string;
  why: string;
  limits: string;
};

const USE_CASE_WORDS: Record<UseCase, string> = {
  CUSTOMER_CARE: "conversations people start with you",
  ACCOUNT_NOTIFICATION: "notices about work already arranged",
  MARKETING: "promotions",
};

export function coverageOf(keys: readonly string[]): Coverage[] {
  const out: Coverage[] = [];
  for (const activity of chosen(keys)) {
    if (!out.some((row) => row.audience === activity.audience && row.category === activity.category)) out.push({ audience: activity.audience, category: activity.category });
  }
  return out;
}

export function planFor(keys: readonly string[], entityType: EntityType | undefined): Plan | null {
  const activities = chosen(keys);
  if (activities.length === 0) return null;
  const coverage = coverageOf(keys);
  const marketing = activities.some((activity) => activity.category === "marketing");
  if (entityType === "SOLE_PROPRIETOR") {
    return {
      usecase: "SOLE_PROPRIETOR",
      subUsecases: [],
      coverage,
      marketing,
      title: "One sole proprietor registration",
      why: "A business without an EIN registers as a sole proprietor. Everything you chose is filed together under your own name.",
      limits: "One number and one registration. Carriers allow about 1,000 texts a day to T-Mobile customers, which is plenty for most solo and small cleaning businesses.",
    };
  }
  const kinds = [...new Set(activities.map((activity) => activity.useCase))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (kinds.length === 1) {
    return {
      usecase: kinds[0],
      subUsecases: [],
      coverage,
      marketing,
      title: "One registration",
      why: `Everything you chose is ${USE_CASE_WORDS[kinds[0]]}, so it is filed as one kind of messaging.`,
      limits: "One number covers it. No extra numbers or registrations are needed.",
    };
  }
  return {
    usecase: "MIXED",
    subUsecases: kinds,
    coverage,
    marketing,
    title: "One mixed registration",
    why: `You chose ${kinds.map((kind) => USE_CASE_WORDS[kind]).join(", ").replace(/, ([^,]*)$/, " and $1")}. Carriers let one registration cover them together when your sign-up wording names each kind, so one number covers everything.`,
    limits: marketing ? "Promotions go only to people who separately agreed to marketing texts. No extra numbers or registrations are needed." : "No extra numbers or registrations are needed.",
  };
}

const ORDER: UseCase[] = ["CUSTOMER_CARE", "ACCOUNT_NOTIFICATION", "MARKETING"];

/** Whether a registration with this coverage lets a text of this audience and category go. Absent coverage is a registration from before coverage existed. */
export function covers(coverage: readonly Coverage[] | undefined, audience: RecipientKind | undefined, category: Category): boolean {
  if (coverage === undefined) return true;
  if (!audience) return coverage.some((row) => row.category === category);
  return coverage.some((row) => row.audience === audience && row.category === category);
}

const AUDIENCE_WORDS: Record<RecipientKind, string> = { customer: "customers and people asking about a cleaning", cleaner: "cleaners on its team", applicant: "people who applied to work with it" };

/** The campaign description carriers read: who gets which texts, and that nothing else is sent. */
export function describe(company: string, keys: readonly string[]): string {
  const activities = chosen(keys);
  const byAudience = new Map<RecipientKind, Activity[]>();
  for (const activity of activities) byAudience.set(activity.audience, [...(byAudience.get(activity.audience) ?? []), activity]);
  const parts = [...byAudience.entries()].map(([audience, rows]) => {
    const words = rows.map((row) => row.label.toLowerCase());
    if (audience === "customer" && rows.some((row) => row.category === "operational")) words.push("visit confirmations, invoices and payment reminders");
    return `to ${AUDIENCE_WORDS[audience]}: ${words.join(", ")}`;
  });
  const marketing = activities.some((row) => row.category === "marketing");
  return `${company} is a cleaning company. It texts people who agreed to receive its texts, ${parts.join("; ")}.${marketing ? " Promotional texts go only to people who separately agreed to marketing texts." : " No marketing or promotional texts are sent."} Every text names ${company}, and STOP, HELP and START are honoured.`.slice(0, 4096);
}

export function sampleKeys(keys: readonly string[], max = 5): string[] {
  // One sample of each kind first, then more of the same until there are enough (carriers read up to five).
  const activities = chosen(keys);
  const out: string[] = [];
  for (const kind of ORDER) {
    const first = activities.find((row) => row.useCase === kind);
    if (first) out.push(first.key);
  }
  for (const row of activities) if (out.length < max && !out.includes(row.key)) out.push(row.key);
  return out.slice(0, max);
}

export function sampleFor(key: string, company: string, edited: Record<string, string>): string {
  return edited[key] ?? activityOf(key)?.sample(company) ?? "";
}
