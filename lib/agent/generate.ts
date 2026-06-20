import { getAnthropicClient, SMS_MODEL } from "@/lib/anthropic/client";
import { withRetry } from "@/lib/retry";
import { log } from "@/lib/log";
import { getOrgSettings } from "@/lib/settings/resolve";
import { resolveTemplate } from "@/lib/templates/queries";

const PITCH_GUIDANCE: Record<string, string> = {
  gentle:
    "Tone: gentle and low-pressure. No urgency, no hard ask. Warm and reassuring.",
  balanced: "Tone: warm and natural, a clear but friendly ask.",
  direct:
    "Tone: clear and direct with one obvious call to action (still human, never pushy or robotic).",
};
import { renderTemplate } from "@/lib/templates/render";
import { buildMergeVars, type MergeVars } from "./context";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type EventKey = Database["public"]["Enums"]["template_event_key"];
type EventType = Database["public"]["Enums"]["event_type"];

const MAX_LEN = 480; // hard ceiling (~3 segments); templates aim < 320

const SYSTEM = `You rewrite ONE text message so it sounds like a real person at a local home-service business texting a customer they just served. Warm, brief, human. Not a marketing department.

HARD RULES (never break — these protect compliance and facts):
- Under 320 characters. One clear ask. Make it obvious where the link goes.
- Keep every FACT exactly as given: business name, cadence, price, and the link, unchanged.
- Never invent prices, discounts, dates, or guarantees that aren't in the baseline.
- If the baseline has a link, your output MUST contain that exact link.
- If the baseline has opt-out text (e.g. "Reply STOP"), keep it.
- Output ONLY the final text. No quotes, no preamble, no explanation.

SOUND HUMAN (this is the whole point — research-backed):
- Use contractions, always: don't, it's, you'll, we'll, I'll. This is the #1 thing that stops a text sounding like a bot.
- Vary sentence length. Pair a short, punchy line with a normal one. Uniform medium-length sentences read as AI.
- Write one-to-one, like the owner texting personally ("I'll hold your spot"), never as a brand ("[Business] is pleased to offer").
- Plain words only. NO corporate filler: never "furthermore," "additionally," "we are pleased to," "valued customer," "exclusive offer," "act now," "kindly," "at your earliest convenience."
- NO em dashes (—). Use a comma, a period, or just start a new sentence. Em dashes read as a bot fingerprint.
- Be concrete and specific to this person, not generic.
- At most ONE emoji, and only if it genuinely fits the tone. Zero is often better.
- A little warmth and slight imperfection is good. Stiff, polished perfection reads as a machine.
- Match how a friendly local owner actually texts: relaxed, direct, no hard sell.`;

/** Light humanizing post-process: strip the em-dash tell, tidy spacing. */
function humanize(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ") // em dash → comma (AI fingerprint removal)
    .replace(/\s*–\s*/g, ", ") // en dash too
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Map a template event key to the event_type recorded on a successful send. */
export function mapEventKeyToEventType(eventKey: EventKey): EventType {
  switch (eventKey) {
    case "post_payment_activation":
      return "activation_sent";
    case "conversion_offer":
      return "conversion_offer_sent";
    default:
      return "message_sent";
  }
}

export type GeneratedMessage = {
  text: string;
  personalized: boolean;
  fallbackUsed: boolean;
};

/** Generate the SMS body for a queued step. Always returns a sendable string. */
export async function generateMessage(args: {
  orgId: string;
  customerId: string;
  eventKey: EventKey;
  jobId?: string;
  planId?: string;
  /** optional prior conversation for reply-style generation (Prompt 19) */
  contextMessages?: { direction: "outbound" | "inbound"; body: string }[];
}): Promise<GeneratedMessage> {
  const admin = createAdminClient();

  // org vertical for template resolution
  const { data: org } = await admin
    .from("organizations")
    .select("vertical_id")
    .eq("id", args.orgId)
    .single();
  if (!org?.vertical_id) {
    return { text: "", personalized: false, fallbackUsed: true };
  }

  const rawTemplate = await resolveTemplate(
    args.orgId,
    org.vertical_id,
    args.eventKey
  );
  const vars: MergeVars = await buildMergeVars({
    orgId: args.orgId,
    customerId: args.customerId,
    jobId: args.jobId,
    planId: args.planId,
    eventKey: args.eventKey,
  });

  const baseline = renderTemplate(rawTemplate ?? "", vars).trim();
  if (!baseline) return { text: "", personalized: false, fallbackUsed: true };

  // try AI personalization
  try {
    const convo = (args.contextMessages ?? [])
      .map((m) => `${m.direction === "inbound" ? "Customer" : "Business"}: ${m.body}`)
      .join("\n");

    // pitch style (Prompt 35) shifts tone within the human-tone rules
    let pitch = "";
    try {
      const settings = await getOrgSettings(args.orgId);
      pitch = PITCH_GUIDANCE[settings.pitchStyle] ?? "";
    } catch {
      /* default tone */
    }

    const user = [
      `Baseline SMS to personalize:\n"${baseline}"`,
      vars.booking_link
        ? `Link that must appear unchanged: ${vars.booking_link}`
        : "",
      convo ? `Recent conversation:\n${convo}` : "",
      pitch,
    ]
      .filter(Boolean)
      .join("\n\n");

    const anthropic = await getAnthropicClient();
    const res = await withRetry(
      () =>
        anthropic.messages.create({
          model: SMS_MODEL,
          max_tokens: 200,
          system: SYSTEM,
          messages: [{ role: "user", content: user }],
        }),
      { label: "anthropic.generate" }
    );

    let text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim()
      .replace(/^["']|["']$/g, "");

    // strip the em-dash tell + tidy spacing (research: em dashes read as bot)
    text = humanize(text);

    // ---- VALIDATE; any failure → deterministic baseline ----
    const linkOk = !vars.booking_link || text.includes(vars.booking_link);
    const optOutOk = !/reply stop/i.test(baseline) || /stop/i.test(text);
    const lenOk = text.length > 0 && text.length <= MAX_LEN;

    if (linkOk && optOutOk && lenOk) {
      return { text, personalized: true, fallbackUsed: false };
    }
    log.warn("agent.fallback_used", {
      eventKey: args.eventKey,
      reason: "validation_failed",
    });
    return { text: baseline, personalized: false, fallbackUsed: true };
  } catch (e) {
    log.warn("agent.fallback_used", {
      eventKey: args.eventKey,
      reason: "ai_failed",
      error: (e as Error)?.message,
    });
    return { text: baseline, personalized: false, fallbackUsed: true };
  }
}
