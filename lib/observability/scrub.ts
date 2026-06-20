// PII scrubbing — the non-negotiable boundary. Never let phone numbers, emails,
// names, message bodies, card data, tokens or secrets reach Sentry or logs.
const PII_KEYS =
  /phone|email|first_?name|last_?name|full_?name|body|message|card|cvc|address|token|secret|api[_-]?key|password|signature/i;

export function scrub(obj: any, depth = 0): any {
  if (depth > 6 || obj == null) return obj;
  if (typeof obj === "string") {
    return obj
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  }
  if (Array.isArray(obj)) return obj.map((v) => scrub(v, depth + 1));
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = PII_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return obj;
}
