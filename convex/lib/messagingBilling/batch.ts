/**
 * Before a person sends many messages at once: who gets one and who does not (and why), how many text
 * segments and email recipients, what it costs, whether the balance covers it, and whether it is over the
 * batch limit. Eligibility is the sending policy's own answer, so the preview never promises a send the
 * policy would refuse. Sending prepared messages uses no AI credits: they are already written.
 */
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { accountFor, billingState } from "../billing/access";
import type { SendIntent } from "../messaging/outbox";
import { checkSend } from "../messaging/policy";
import { controlsOf, meteringOn } from "./ledger";
import { formatUnits } from "./money";
import { rateCardAt } from "./rates";
import { smsRoute } from "./routes";
import { countSegments, plainPunctuation } from "./segments";

type Ctx = QueryCtx | MutationCtx;

export type BatchItem = {
  key: string;
  name: string;
  channel: "sms" | "email";
  to: string | null;
  body: string;
  intent: SendIntent;
  /** A reason this item cannot go that the caller already knows (for example, the record changed). */
  excluded?: string | null;
  /** Agent-written text is sent with plain punctuation. */
  agent?: boolean;
};

export type BatchPreview = Awaited<ReturnType<typeof batchPreview>>;

async function sendsThroughGmail(ctx: Ctx, companyId: Id<"companies">): Promise<boolean> {
  const rows = await ctx.db
    .query("mailboxConnections")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(20);
  return rows.some((row) => row.provider === "gmail" && row.canSend && row.status === "connected");
}

export async function batchPreview(ctx: Ctx, companyId: Id<"companies">, items: BatchItem[], now = Date.now()) {
  const card = rateCardAt(now);
  // Routes and the ten-segment cap are checked only while metering is on, exactly as at sending time.
  const metering = meteringOn();
  const gmail = await sendsThroughGmail(ctx, companyId);
  const eligible: { key: string; name: string; channel: "sms" | "email"; segments: number; cost: number; later: string | null }[] = [];
  const excluded: { key: string; name: string; why: string }[] = [];
  for (const item of items) {
    if (item.excluded) {
      excluded.push({ key: item.key, name: item.name, why: item.excluded });
      continue;
    }
    if (!item.to) {
      excluded.push({ key: item.key, name: item.name, why: item.channel === "sms" ? "No phone number to text." : "No email address." });
      continue;
    }
    const policy = await checkSend(ctx, { companyId, channel: item.channel, to: item.to, now, ...item.intent });
    if (!policy.ok && policy.retryAt === undefined) {
      excluded.push({ key: item.key, name: item.name, why: policy.words });
      continue;
    }
    const later = !policy.ok ? policy.words : null;
    if (item.channel === "sms") {
      const route = smsRoute(item.to);
      if (metering && !route.ok) {
        excluded.push({ key: item.key, name: item.name, why: route.words });
        continue;
      }
      const count = countSegments(item.agent ? plainPunctuation(item.body) : item.body);
      if (metering && count.tooLong) {
        excluded.push({ key: item.key, name: item.name, why: `Too long for a text (${count.segments} segments; the most is 10).` });
        continue;
      }
      eligible.push({ key: item.key, name: item.name, channel: "sms", segments: count.segments, cost: count.segments * card.rates.sms_out, later });
    } else {
      eligible.push({ key: item.key, name: item.name, channel: "email", segments: 0, cost: gmail ? 0 : card.rates.email_out, later });
    }
  }
  const segments = eligible.reduce((sum, row) => sum + row.segments, 0);
  const emails = eligible.filter((row) => row.channel === "email").length;
  const cost = metering ? eligible.reduce((sum, row) => sum + row.cost, 0) : 0;
  const state = billingState();
  const account = state.connected ? await accountFor(ctx, companyId, state.env) : null;
  const balance = account?.messaging?.remaining ?? null;
  const batchLimit = account ? (controlsOf(account).batchLimit ?? null) : null;
  const overLimit = metering && batchLimit !== null && cost > batchLimit;
  const covered = !metering || (balance !== null && balance >= cost);
  const texts = eligible.filter((row) => row.channel === "sms").length;
  const parts = [
    `${eligible.length} of ${items.length} will be sent${excluded.length ? `; ${excluded.length} can't be` : ""}.`,
    texts ? `${texts} text${texts === 1 ? "" : "s"} using ${segments} SMS segment${segments === 1 ? "" : "s"}.` : "",
    emails ? `${emails} email${emails === 1 ? "" : "s"}${gmail ? " through your Gmail (included)" : ""}.` : "",
    metering ? `Estimated cost: ${formatUnits(cost)}.` : "Messaging charges haven't started for your account, so this costs nothing yet.",
    "AI credits: none. These are already written.",
  ].filter(Boolean);
  return {
    eligible,
    excluded,
    total: items.length,
    segments,
    emails,
    gmail,
    metering,
    cost,
    balance,
    covered,
    batchLimit,
    overLimit,
    aiCredits: 0,
    words: parts.join(" "),
    problem: overLimit
      ? `This batch would cost about ${formatUnits(cost)}, more than your ${formatUnits(batchLimit!)} batch limit. Send fewer at once, or raise the limit on the Messaging tab of Plan & Usage.`
      : !covered
        ? `This batch needs about ${formatUnits(cost)} and the messaging balance is ${formatUnits(balance ?? 0)}. Messages the balance can't cover wait as drafts until funds are added.`
        : null,
  };
}

/** Refuses a batch over the Owner's batch limit before anything is queued. A low balance does not refuse: what can't be paid for waits. */
export function batchRefusal(preview: BatchPreview): string | null {
  return preview.overLimit ? preview.problem : null;
}
