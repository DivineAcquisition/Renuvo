import Anthropic from "@anthropic-ai/sdk";

// Current Sonnet for fast, cheap, high-quality SMS personalization.
export const SMS_MODEL = "claude-sonnet-4-6";

// Lazy init (like the Stripe client): never construct at import time, so a
// missing ANTHROPIC_API_KEY can't fail `next build`. Calls only fail at runtime
// if the key is absent — generation falls back to the deterministic template.
let _client: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const client = getAnthropic();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
