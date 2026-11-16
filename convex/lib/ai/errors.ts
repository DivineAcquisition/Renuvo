/**
 * What went wrong with a model call, kept apart so each is handled for what it is:
 *  - refusal: the model declined. Never retried on another provider.
 *  - invalid_output: the answer did not match the shape asked for.
 *  - not_configured: no key or the capability is off. Nothing was sent.
 *  - rate_limited / outage / timeout: the provider could not answer now. May fall back where allowed.
 *  - rejected_input: the provider refused the input itself (too large, wrong type, its own policy).
 *  - business_refusal: Selestial's own rules said no before anything was sent.
 *  - cancelled: a person stopped it.
 *  - uncertain: the request may have run; it must be reconciled, never blindly sent again.
 * `words` are for a person. Provider responses, keys and stack text never go in them.
 */
export const AI_ERROR_KINDS = ["refusal", "invalid_output", "not_configured", "rate_limited", "outage", "timeout", "rejected_input", "business_refusal", "cancelled", "uncertain"] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly words: string,
    /** The provider's HTTP status, for logs. Never shown to a person. */
    readonly status?: number,
  ) {
    super(words);
  }
  /** Whether another allowed provider may try. A refusal or a bad input never qualifies. */
  get fallbackEligible(): boolean {
    return this.kind === "outage" || this.kind === "rate_limited";
  }
}

const WORDS: Record<AiErrorKind, string> = {
  refusal: "The model declined this request. Try rephrasing what you need.",
  invalid_output: "The model's answer could not be read, so nothing was done with it.",
  not_configured: "This AI feature is not connected on this deployment yet.",
  rate_limited: "The AI provider is busy right now. Try again in a minute.",
  outage: "The AI provider had a problem. Try again.",
  timeout: "The AI provider took too long to answer.",
  rejected_input: "The AI provider could not accept this input.",
  business_refusal: "Selestial's rules do not allow this.",
  cancelled: "Stopped.",
  uncertain: "The provider's answer was lost on the way back. It may still have run, so it was not sent again.",
};

export function aiError(kind: AiErrorKind, words?: string, status?: number): AiError {
  return new AiError(kind, words ?? WORDS[kind], status);
}

/** The kind of failure an HTTP status means. */
export function kindForStatus(status: number): AiErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "not_configured";
  if (status === 400 || status === 404 || status === 413 || status === 415 || status === 422) return "rejected_input";
  if (status === 408 || status === 504) return "timeout";
  return "outage";
}
