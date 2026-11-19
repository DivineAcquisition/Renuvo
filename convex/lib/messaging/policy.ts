/**
 * The one sending policy. Every outbound message is checked here when it is planned and again at the
 * moment it is handed to the provider, so a STOP, a withdrawn permission, a suspension or a paused agent
 * that arrives in between still stops it. The checks run in a fixed order and the first that fails
 * answers, with its own code and words a person can act on. Nothing here is written by a model.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { clockMinutes, readProfile } from "../compliance/profile";
import { activeSuppressions, blockingSuppression, currentPermission } from "../compliance/permissions";
import { normalAddress, recipientRecord, recipientsAt } from "../compliance/recipients";
import { CATEGORIES, CHANNELS, type Category, type Channel, type Origin, type Recipient, type ReplyKind } from "../compliance/schema";
import { localParts } from "../availability";
import { AGENT_PROFILES } from "../departments";
import { covers } from "../texting/plan";
import type { Agent } from "../statuses";
import { clock } from "../time";

type Ctx = QueryCtx | MutationCtx;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = 7 * DAY;

export const POLICY_CODES = ["company_suspended", "agent_paused", "sender_not_ready", "no_address", "not_registered", "suppressed", "no_permission", "quiet_hours", "frequency"] as const;
export type PolicyCode = (typeof POLICY_CODES)[number];

/** The general words for each code. An answer carries more exact words for the case at hand. */
export const POLICY_WORDS: Record<PolicyCode, string> = {
  company_suspended: "Sending is suspended for this company by Selestial.",
  agent_paused: "The agent is paused, so it sends nothing. A person can still send.",
  sender_not_ready: "The company's sending setup is not finished.",
  no_address: "There is no usable address for this person on this channel.",
  not_registered: "The company's texting registration does not cover this kind of text to this person.",
  suppressed: "This address asked not to be contacted.",
  no_permission: "There is no recorded permission to send this kind of message to this person.",
  quiet_hours: "It is within the company's quiet hours. It can go when they end.",
  frequency: "This person has had as many of these messages this week as the company allows.",
};

export type PolicyInput = {
  companyId: Id<"companies">;
  channel: Channel;
  to: string;
  recipient?: Recipient;
  category: Category;
  origin: Origin;
  /** The agent sending, for automated sends. A send with no agent named is never held by a pause. */
  agent?: Agent;
  now: number;
  /** The planned message being checked again at sending time, so it does not count against its own weekly limit. */
  messageId?: Id<"messages">;
  /** A direct answer to a STOP, HELP or START the person just texted. See checkSend. */
  reply?: ReplyKind;
};

export type PolicyAnswer = { ok: true } | { ok: false; code: PolicyCode; words: string; retryAt?: number };

const AGENT_ORIGINS: readonly Origin[] = ["agent", "dispatch", "follow_up", "win_back", "recruiting"];
const COUNTED: readonly Doc<"messages">["status"][] = ["queued", "held", "sending", "sent", "delivered", "unconfirmed"];

const CATEGORY_WORDS: Record<Category, string> = { operational: "work", marketing: "marketing", recruiting: "recruiting" };
const CHANNEL_WORDS: Record<Channel, string> = { sms: "texts", email: "emails" };
const AUDIENCE_WORDS: Record<Recipient["kind"], string> = { customer: "customers", cleaner: "cleaners", applicant: "applicants" };

function no(code: PolicyCode, words: string, retryAt?: number): PolicyAnswer {
  return retryAt === undefined ? { ok: false, code, words } : { ok: false, code, words, retryAt };
}

/** The reasons, in words, that the profile cannot send on this channel yet. Empty means ready. */
export function senderGaps(messaging: Awaited<ReturnType<typeof readProfile>>["messaging"], channel: Channel): { key: string; words: string }[] {
  const gaps: { key: string; words: string }[] = [];
  if (channel === "sms") {
    if (!messaging.senderName) gaps.push({ key: "sender_name", words: "Texting needs the business name texts are sent as." });
    if (!messaging.smsNumber) gaps.push({ key: "sms_number", words: "Texting needs the company's texting number." });
    // What a provider requires before business texts go out varies by provider and by use case. The
    // profile records whether the registration was approved, so the code asks for exactly that.
    const status = messaging.registration.status;
    if (status !== "approved") {
      gaps.push({
        key: "registration",
        words:
          status === "rejected"
            ? "Texting is blocked: the carrier registration was rejected."
            : status === "suspended"
              ? "Texting is paused: the carriers suspended the registration. Selestial is looking into it."
            : status === "submitted"
              ? "Texting needs carrier registration approval. It was submitted and is waiting."
              : "Texting needs carrier registration approval. It has not been submitted.",
      });
    }
  } else if (!messaging.emailFromAddress) {
    gaps.push({ key: "email_from", words: "Email needs the address messages are sent from." });
  }
  return gaps;
}

/** If `now` is inside the quiet window on the company's clock, the instant the window ends. Otherwise null. */
export function quietUntil(now: number, timezone: string, window: { start: string; end: string }): number | null {
  const minute = localParts(now, timezone).minute;
  const start = clockMinutes(window.start);
  const end = clockMinutes(window.end);
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) return null;
  const wait = (end - minute + 1440) % 1440;
  return Math.floor(now / MINUTE) * MINUTE + wait * MINUTE;
}

/**
 * Whether this message may be sent now. In order: company suspended, agent paused, sender not ready,
 * no usable address, not covered by the texting registration, suppressed, no permission, quiet hours,
 * weekly limit.
 *
 * A reply to a keyword (STOP, HELP, START) is the answer to the person's own text: it is not held by
 * the suppression that the STOP just made, it needs no permission because the person wrote first, and
 * it is not held for quiet hours because it answers them right away. Everything else still applies.
 */
export async function checkSend(ctx: Ctx, input: PolicyInput): Promise<PolicyAnswer> {
  const company = await ctx.db.get(input.companyId);
  if (!company || company.suspendedAt !== undefined) return no("company_suspended", "Sending is suspended for this company by Selestial. Nothing is sent until Selestial lifts it.");

  if (AGENT_ORIGINS.includes(input.origin) && input.agent && company.pausedAgents.includes(input.agent)) {
    return no("agent_paused", `${AGENT_PROFILES[input.agent].name} is paused, so it sends nothing. A person can still send.`);
  }

  const profile = await readProfile(ctx, input.companyId);
  const gaps = senderGaps(profile.messaging, input.channel);
  if (gaps.length > 0) return no("sender_not_ready", gaps.map((gap) => gap.words).join(" "));

  const address = normalAddress(input.channel, input.to);
  if (!address) return no("no_address", input.channel === "sms" ? "There is no valid phone number to text." : "There is no valid email address to send to.");

  // A text goes only if the registration was filed for this audience and this kind of text. A reply to
  // STOP, HELP or START answers the person's own text and is always allowed on a registered number.
  const coverage = profile.messaging.registration.coverage;
  if (input.channel === "sms" && !input.reply && coverage) {
    const kinds = input.recipient ? [input.recipient.kind] : [...new Set((await recipientsAt(ctx, input.companyId, "sms", address)).map((row) => row.kind))];
    if (kinds.length === 0 && !covers(coverage, undefined, input.category)) {
      return no("not_registered", `Your texting registration doesn't cover ${CATEGORY_WORDS[input.category]} texts. Add them in Set up business texting.`);
    }
    const missing = kinds.find((kind) => !covers(coverage, kind, input.category));
    if (missing) return no("not_registered", `Your texting registration doesn't cover ${CATEGORY_WORDS[input.category]} texts to ${AUDIENCE_WORDS[missing]}. Add them in Set up business texting.`);
  }

  if (!input.reply) {
    const suppression = blockingSuppression(await activeSuppressions(ctx, input.companyId, input.channel, address), input.category);
    if (suppression) {
      return no(
        "suppressed",
        suppression.reason === "stop_keyword"
          ? "This number replied STOP, so it gets no texts from this business until it replies START."
          : `This ${input.channel === "sms" ? "number" : "address"} is on the do-not-contact list${suppression.scope === "all" ? "" : ` for ${CATEGORY_WORDS[suppression.scope as Category]} messages`}.`,
      );
    }

    const permission = await permissionAnswer(ctx, input, address);
    if (permission) return permission;
  }

  const quiet = profile.messaging.quietHours;
  if (!input.reply && quiet && (input.category !== "operational" || quiet.appliesToOperational)) {
    // The recipient's own time zone is not known, so quiet hours are kept on the company's clock.
    const until = quietUntil(input.now, company.timezone, quiet);
    if (until !== null) return no("quiet_hours", `It is within quiet hours (${quiet.start} to ${quiet.end} company time). It can go at ${clock(until, company.timezone)}.`, until);
  }

  if (input.category === "marketing" || input.category === "recruiting") {
    const limit = input.category === "marketing" ? profile.messaging.frequency.marketingPerWeek : profile.messaging.frequency.recruitingPerWeek;
    const sent = await countThisWeek(ctx, input.companyId, input.channel, address, input.category, input.now, input.messageId);
    if (sent >= limit) {
      return no("frequency", `This person already has ${sent} ${CATEGORY_WORDS[input.category]} ${sent === 1 ? "message" : "messages"} in the last 7 days. The company allows ${limit} a week.`);
    }
  }
  return { ok: true };
}

async function permissionAnswer(ctx: Ctx, input: PolicyInput, address: string): Promise<PolicyAnswer | null> {
  const what = `${CATEGORY_WORDS[input.category]} ${CHANNEL_WORDS[input.channel]}`;
  let recipients: Recipient[];
  if (input.recipient) recipients = [input.recipient];
  else recipients = (await recipientsAt(ctx, input.companyId, input.channel, address)).map((row) => ({ kind: row.kind, id: row.id }));
  if (recipients.length === 0) return no("no_permission", `Nobody in the record has this ${input.channel === "sms" ? "number" : "address"}, so there is no permission to send ${what}.`);
  // When several people share an address, every one of them must have agreed: one person's withdrawal stands.
  for (const recipient of recipients) {
    const row = await currentPermission(ctx, input.companyId, recipient, input.channel, input.category);
    if (!row || row.status !== "granted") return no("no_permission", `There is no recorded permission to send ${what} to this person.`);
    if (row.source === "import") return no("no_permission", `There is no recorded permission to send ${what} to this person. An imported contact is not permission.`);
    if (input.channel === "sms" && input.category === "marketing" && !row.disclosureId && !row.disclosureText) {
      return no("no_permission", "Marketing texts need the exact wording the person agreed to, and none is recorded.");
    }
  }
  return null;
}

async function countThisWeek(ctx: Ctx, companyId: Id<"companies">, channel: Channel, address: string, category: Category, now: number, except?: Id<"messages">): Promise<number> {
  const rows = await ctx.db
    .query("sendIntents")
    .withIndex("by_company_address_category_at", (q) => q.eq("companyId", companyId).eq("channel", channel).eq("address", address).eq("category", category).gt("at", now - WEEK))
    .take(100);
  let count = 0;
  for (const row of rows) {
    if (row.messageId === except) continue;
    const message = await ctx.db.get(row.messageId);
    if (message && COUNTED.includes(message.status)) count += 1;
  }
  return count;
}

export type Explained = { channel: Channel; category: Category; address: string | null; answer: PolicyAnswer };

/** What would happen now if a person sent each kind of message to this recipient by hand. For the screens. */
export async function explainRecipient(ctx: Ctx, companyId: Id<"companies">, recipient: Recipient, now = Date.now()): Promise<Explained[]> {
  const record = await recipientRecord(ctx, companyId, recipient);
  const out: Explained[] = [];
  for (const channel of CHANNELS) {
    const address = record ? (channel === "sms" ? record.phone : record.email) : null;
    for (const category of CATEGORIES) {
      const answer = await checkSend(ctx, { companyId, channel, to: address ?? "", recipient, category, origin: "manual", now });
      out.push({ channel, category, address, answer });
    }
  }
  return out;
}
