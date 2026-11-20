/**
 * What Selestial tells the people who run a company, by email, and who owns each notice
 * (docs/email/00-architecture.md §5). One list, read by the router, the preferences page and the tests.
 *
 * In-app records (tasks, approvals, the billing screen) always exist. These notices are layered on top,
 * so turning one off never hides anything in the product.
 */
import { v } from "convex/values";

import type { Role } from "../roles";

// ── Categories: what a person can turn on or off ─────────────────────────────────────────────────

export const NOTICE_CATEGORIES = ["security", "account", "approvals", "escalations", "activity", "digest", "product"] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];
export const noticeCategoryValidator = v.union(...NOTICE_CATEGORIES.map((c) => v.literal(c)));

export type CategoryInfo = {
  label: string;
  /** What arrives under it, in one sentence. */
  about: string;
  /** On for a person who has never changed it. */
  defaultOn: boolean;
  /**
   * Who can't turn it off. "everyone": security notices. "owner": the Owner always gets account notices
   * (a payment failing, an inbox disconnecting) because nobody else can fix them.
   */
  locked?: "everyone" | "owner";
  /** Mail a person can leave with one click (List-Unsubscribe). Never security or account notices. */
  unsubscribable: boolean;
};

export const CATEGORY_INFO: Record<NoticeCategory, CategoryInfo> = {
  security: { label: "Security", about: "Changes to who can get in, connected inboxes, where payouts go, and your company's data.", defaultOn: true, locked: "everyone", unsubscribable: false },
  account: { label: "Account & connections", about: "A payment that didn't go through, credits running out, or an inbox that needs reconnecting.", defaultOn: true, locked: "owner", unsubscribable: false },
  approvals: { label: "Approvals", about: "When an agent you've set to Ask me first wants to do something, and a reminder before its deadline.", defaultOn: true, unsubscribable: true },
  escalations: { label: "Urgent operations", about: "When a visit is at risk and Dispatch can't fix it on its own, a customer raises a serious concern, a customer case needs your decision, or a commitment to a customer is overdue.", defaultOn: true, unsubscribable: true },
  activity: { label: "What your agents did", about: "Things agents did on their own when set to Act and notify me, how customer cases ended, and customer payments that failed.", defaultOn: true, unsubscribable: true },
  digest: { label: "Weekly summary", about: "Monday morning: last week's visits, payments and decisions from your records, and what's waiting on you.", defaultOn: true, unsubscribable: true },
  product: { label: "Product news", about: "New features and changes to Selestial. A few times a year.", defaultOn: false, unsubscribable: true },
};

/** Whether this person may turn this category off. */
export function canTurnOff(category: NoticeCategory, role: Role): boolean {
  const locked = CATEGORY_INFO[category].locked;
  return !(locked === "everyone" || (locked === "owner" && role === "owner"));
}

// ── Events: what sends a notice ──────────────────────────────────────────────────────────────────

/**
 * critical: goes at once, any hour. high and normal: go at once, outside the night hours on the company's
 * clock. digest: only as part of its own scheduled send.
 */
export type Priority = "critical" | "high" | "normal" | "digest";

/** Who gets it, by role. "connector" adds the member who connected the thing it's about. */
export type Audience = "owner" | "managers" | "everyone";

export const NOTICE_EVENTS = ["welcome", "security_change", "approval_needed", "approval_expiring", "agent_acted", "dispatch_escalation", "weekly_digest", "plan_payment_failed", "credits_exhausted", "customer_payment_failed", "inbox_reconnect", "retention_serious", "retention_attention", "retention_outcome", "texting_progress", "texting_attention", "activation_result", "activation_summary", "support_summary", "service_attention"] as const;
export type NoticeEvent = (typeof NOTICE_EVENTS)[number];
export const noticeEventValidator = v.union(...NOTICE_EVENTS.map((e) => v.literal(e)));

export type EventInfo = {
  category: NoticeCategory;
  priority: Priority;
  audience: Audience;
  /** The system that owns it. Selestial sends nothing another system already sends. */
  owner: "selestial";
  /** In words, for the catalog and the preferences page. */
  when: string;
};

export const EVENT_INFO: Record<NoticeEvent, EventInfo> = {
  welcome: { category: "account", priority: "normal", audience: "owner", owner: "selestial", when: "Once, when an Owner creates a company." },
  security_change: { category: "security", priority: "critical", audience: "owner", owner: "selestial", when: "A role changes, someone is removed, an inbox is connected, the payout account changes, deletion is requested, or an export is ready." },
  approval_needed: { category: "approvals", priority: "high", audience: "managers", owner: "selestial", when: "An agent set to Ask me first proposes something." },
  approval_expiring: { category: "approvals", priority: "high", audience: "managers", owner: "selestial", when: "Two hours before an undecided proposal's deadline." },
  agent_acted: { category: "activity", priority: "normal", audience: "managers", owner: "selestial", when: "An agent set to Act and notify me did something on its own." },
  dispatch_escalation: { category: "escalations", priority: "critical", audience: "everyone", owner: "selestial", when: "A cleaner hasn't checked in, may not show, or nobody has taken a visit close to its start." },
  weekly_digest: { category: "digest", priority: "digest", audience: "everyone", owner: "selestial", when: "Mondays at 7:30 AM company time." },
  plan_payment_failed: { category: "account", priority: "critical", audience: "owner", owner: "selestial", when: "The Selestial plan payment is declined." },
  credits_exhausted: { category: "account", priority: "high", audience: "owner", owner: "selestial", when: "Selestial Credits run out and AI work pauses." },
  customer_payment_failed: { category: "activity", priority: "high", audience: "managers", owner: "selestial", when: "A customer's card payment fails." },
  inbox_reconnect: { category: "account", priority: "critical", audience: "owner", owner: "selestial", when: "A connected inbox stops working." },
  retention_serious: { category: "escalations", priority: "critical", audience: "managers", owner: "selestial", when: "A customer reports a safety, damage, theft or staff-conduct concern." },
  retention_attention: { category: "escalations", priority: "high", audience: "managers", owner: "selestial", when: "A customer case needs a person's decision and no approval is already waiting, or a commitment to a customer has passed its deadline." },
  retention_outcome: { category: "activity", priority: "normal", audience: "managers", owner: "selestial", when: "A recovery, plan-change, renewal or return case closes with its recorded outcome." },
  texting_progress: { category: "account", priority: "normal", audience: "owner", owner: "selestial", when: "Business texting: Selestial received the setup, the carriers approved it while the number is still connecting, or texting is ready." },
  texting_attention: { category: "account", priority: "high", audience: "owner", owner: "selestial", when: "Business texting needs the Owner (a correction, a confirmation code or another number), or the carriers paused it." },
  activation_result: { category: "activity", priority: "normal", audience: "owner", owner: "selestial", when: "The first useful result of the agent work the Owner started is ready: a draft, a form, prepared follow-ups or a decision." },
  activation_summary: { category: "activity", priority: "normal", audience: "owner", owner: "selestial", when: "The first batch of agent work the Owner started has settled: what was made, what waits on them, and anything blocked." },
  service_attention: { category: "account", priority: "high", audience: "owner", owner: "selestial", when: "Something in Selestial needs the Owner to act (reconnect an app, retry work, update an address), or a serious interruption begins. One email per problem, never one per retry." },
  support_summary: { category: "security", priority: "high", audience: "owner", owner: "selestial", when: "Selestial Support finished a session in which it changed something: what it changed, and why it was there." },
};

/** The roles an audience reaches. */
export function rolesFor(audience: Audience): readonly Role[] {
  return audience === "owner" ? ["owner"] : audience === "managers" ? ["owner", "manager"] : ["owner", "manager", "office"];
}

/** Hours on the company's clock when only critical notices go: 9 PM to 7 AM. */
export const NIGHT = { start: "21:00", end: "07:00" } as const;

/**
 * Small facts captured when the event happened (a name, a role, an amount), for notices whose record can
 * change afterwards. Never message text, never a token.
 */
export const noticeFactsValidator = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));
export type NoticeFacts = typeof noticeFactsValidator.type;
