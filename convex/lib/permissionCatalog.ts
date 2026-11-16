/**
 * What each agent may do, action by action (brief, sections 7 and 11 to 14). The catalog is code: an
 * owner chooses a level per action, and cannot invent an action or lift one past its ceiling.
 * Permission to send a reminder does not grant permission to discount a service.
 */
import { literals, type Agent } from "./statuses";

export const LEVELS = ["off", "propose", "execute_and_report", "execute"] as const;
export type Level = (typeof LEVELS)[number];
export const levelValidator = literals(LEVELS);

export function rank(level: Level): number {
  return LEVELS.indexOf(level);
}

export type ActionDef = {
  key: string;
  agent: Agent;
  label: string;
  /** The level the brief names as the default once the company trusts this action. */
  standard: Level;
  /** The most an owner may grant. "propose" means a person approves every time. */
  ceiling: Level;
  /** A customer, cleaner or applicant sees the result. These start on Propose in every new company. */
  outsider: boolean;
  /** Money moves. The owner sets a limit per action and per day. */
  money: boolean;
};

const action = (key: string, agent: Agent, label: string, standard: Level, options: Partial<Pick<ActionDef, "ceiling" | "outsider" | "money">> = {}): ActionDef => ({
  key,
  agent,
  label,
  standard,
  ceiling: options.ceiling ?? "execute",
  outsider: options.outsider ?? true,
  money: options.money ?? false,
});

export const ACTIONS: readonly ActionDef[] = [
  action("dispatch.request_acceptance", "dispatch", "Send the first offers for a visit", "execute"),
  action("dispatch.send_replacement_offer", "dispatch", "Offer a visit to the next cleaner after a no or no answer", "execute"),
  action("dispatch.run_backup_coverage", "dispatch", "Find cover when a cleaner drops out or does not arrive", "execute_and_report"),
  action("dispatch.broadcast_offer", "dispatch", "Ask several cleaners at once for one opening", "propose"),
  action("dispatch.declare_no_show", "dispatch", "Declare a no-show once the contact steps have run", "propose", { outsider: false }),
  action("dispatch.request_urgent_hire", "dispatch", "Ask Recruiter for an urgent hire", "execute", { outsider: false }),
  action("dispatch.send_reminder", "dispatch", "Send reminders and confirmations", "execute"),
  action("dispatch.act_on_cleaner_reply", "dispatch", "Act on a cleaner's text: running late, can't come, or declining an offer", "execute_and_report", { ceiling: "execute_and_report" }),
  action("dispatch.notify_running_late", "dispatch", "Tell a customer a visit is running late", "execute_and_report"),
  action("dispatch.close_visit", "dispatch", "Close a visit on clean evidence", "execute_and_report", { outsider: false }),
  action("dispatch.reassign_confirmed_visit", "dispatch", "Reassign a confirmed visit", "propose"),
  action("dispatch.override_time_between_jobs", "dispatch", "Override the time-between-jobs rule", "propose", { ceiling: "propose", outsider: false }),

  action("sales.reply_and_quote", "sales", "Reply, collect details and send a quote from the rules", "execute"),
  action("sales.follow_up", "sales", "Send follow-up messages", "execute"),
  action("sales.discount_in_band", "sales", "Discount inside the allowed band", "execute_and_report", { money: true }),
  action("sales.draft_ad_campaign", "sales", "Draft a Google Ads campaign (costs nothing; the Owner approves and turns it on)", "execute", { outsider: false }),
  action("sales.discount_out_of_band", "sales", "Discount outside the band, custom or commercial price", "propose", { ceiling: "propose", money: true }),

  action("retention.request_feedback", "retention", "Request feedback, invite a review, send reminders", "execute"),
  action("retention.offer_recurring_plan", "retention", "Offer a recurring plan at the standard price", "execute"),
  action("retention.recover_payment", "retention", "Payment recovery messages and retries", "execute", { money: true }),
  action("retention.remedy_within_limit", "retention", "Re-clean or credit inside the limit", "execute_and_report", { money: true }),
  action("retention.refund_above_limit", "retention", "Refund or compensation above the limit", "propose", { ceiling: "propose", money: true }),
  action("retention.cancel_on_request", "retention", "Cancel on the customer's request", "execute"),
  action("retention.draft_review_reply", "retention", "Draft replies to Google reviews (a person approves before anything is posted)", "execute", { outsider: false }),

  action("recruiter.acknowledge_and_collect", "recruiter", "Acknowledge, answer questions, request missing details", "execute"),
  action("recruiter.decline_fixed_requirement", "recruiter", "Decline on a published fixed requirement", "execute_and_report"),
  action("recruiter.run_interview", "recruiter", "Coordinate and run the interview", "execute"),
  action("recruiter.advance_candidate", "recruiter", "Move a candidate forward, mark a cleaner ready", "propose", { ceiling: "propose", outsider: false }),
  action("recruiter.send_invitation", "recruiter", "Email an applicant the application link", "execute"),
  action("recruiter.follow_up", "recruiter", "Remind an applicant about an unfinished application", "execute"),
  action("recruiter.send_offer", "recruiter", "Send a hiring offer on terms the Owner approved", "propose", { ceiling: "propose" }),
  action("recruiter.urgent_outreach", "recruiter", "Contact existing applicants about an urgent staffing need", "propose", { ceiling: "propose" }),
];

/** These need a person at any setting. They are not permissions, so nothing can switch them on. */
export const PERSON_ONLY: readonly { key: string; label: string }[] = [
  { key: "person.cleaner_consequence", label: "Any consequence for a cleaner, including rejecting or ending a worker" },
  { key: "person.after_background_check", label: "Any decision that follows a background check" },
  { key: "person.pay_run", label: "Paying out a pay run" },
  { key: "person.change_prices_pay_policies", label: "Changing prices, pay rates or policies" },
  { key: "person.legal_injury_damage_dispute", label: "Anything legal, an injury, property damage or a payment dispute" },
];

const BY_KEY = new Map(ACTIONS.map((def) => [def.key, def]));

export function actionDef(key: string): ActionDef | undefined {
  return BY_KEY.get(key);
}

/** Every company starts with review: anything an outsider sees begins on Propose, whatever it loosens to later. */
export function initialLevel(def: ActionDef): Level {
  return def.outsider && rank(def.standard) > rank("propose") ? "propose" : def.standard;
}
