import { getAnthropicClient, SMS_MODEL } from "@/lib/anthropic/client";

export type Intent =
  | "interested"
  | "objection"
  | "question"
  | "not_interested"
  | "unclear";

const CLASSIFY_SYSTEM = `You classify a customer's latest SMS reply in a conversation where a home-service business is offering to convert a one-time job into recurring service.
Return ONLY a JSON object: {"intent":"<value>"} with one of:
- "interested": says yes / sounds good / wants to sign up / asks how to start.
- "objection": hesitation about price, commitment, frequency, or need ("too expensive", "not sure", "maybe later").
- "question": asking for information (what's included, can I change days, etc.).
- "not_interested": a clear no / stop offering this (but NOT the literal word STOP).
- "unclear": ambiguous, off-topic, or can't tell.
No prose, no markdown, only the JSON.`;

const INTENTS: Intent[] = [
  "interested",
  "objection",
  "question",
  "not_interested",
  "unclear",
];

export async function classifyIntent(
  latestText: string,
  context: { direction: "outbound" | "inbound"; body: string }[]
): Promise<Intent> {
  const convo = context
    .map(
      (m) => `${m.direction === "inbound" ? "Customer" : "Business"}: ${m.body}`
    )
    .join("\n");

  try {
    const anthropic = await getAnthropicClient();
    const res = await anthropic.messages.create({
      model: SMS_MODEL,
      max_tokens: 30,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${convo ? convo + "\n" : ""}Customer (latest): ${latestText}`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const intent = parsed.intent as Intent;
    return INTENTS.includes(intent) ? intent : "unclear";
  } catch {
    return "unclear";
  }
}
