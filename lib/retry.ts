import { log } from "./log";

/**
 * Retry a transient external call with exponential backoff. Use for network
 * calls (Telnyx, Anthropic, Stripe object creation) — NOT for idempotency-
 * sensitive or transactional DB writes (rely on unique indexes there instead).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const { retries = 3, baseMs = 300, label = "op" } = opts;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      log.warn("retry.attempt", {
        label,
        attempt: i + 1,
        error: (e as Error)?.message,
      });
      if (i < retries - 1)
        await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
