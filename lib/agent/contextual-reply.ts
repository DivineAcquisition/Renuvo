import { getAnthropicClient, SMS_MODEL } from "@/lib/anthropic/client";

// Reuse the same human-tone constraints as generation. No invented facts.
const REPLY_SYSTEM = `You are texting AS a friendly local home-service business owner, replying to a customer about recurring service. Sound human, not like a bot.
RULES:
- Under 320 characters. Use contractions. Vary sentence length. No em dashes. No corporate filler.
- Never invent prices, dates, discounts, or specifics you weren't given. If you don't know, offer to have someone follow up.
- One clear next step. Warm, low-pressure, never a hard sell.
- Output ONLY the reply text.`;

export async function generateContextualReply(args: {
  task: string; // e.g. "Answer their question briefly" / "Acknowledge they're not interested, leave the door open"
  context: { direction: "outbound" | "inbound"; body: string }[];
  businessName: string;
  bookingLink?: string;
}): Promise<string> {
  const convo = args.context
    .map(
      (m) => `${m.direction === "inbound" ? "Customer" : "Business"}: ${m.body}`
    )
    .join("\n");

  try {
    const anthropic = await getAnthropicClient();
    const res = await anthropic.messages.create({
      model: SMS_MODEL,
      max_tokens: 200,
      system: REPLY_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `You are: ${args.businessName}`,
            args.bookingLink
              ? `If they want to proceed, share this link: ${args.bookingLink}`
              : "",
            `Conversation:\n${convo}`,
            `Task: ${args.task}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    let text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s*[—–]\s*/g, ", ");
    if (!text || text.length > 480) {
      return `Thanks for the reply! I'll have someone from ${args.businessName} follow up shortly.`;
    }
    return text;
  } catch {
    return `Thanks for the reply! I'll have someone from ${args.businessName} follow up shortly.`;
  }
}
