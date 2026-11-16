/**
 * The one way the AI layer reaches the network. Only the providers' own hosts, over HTTPS, with a time
 * limit, a size limit and bounded retries. A model's output can never choose a URL to fetch: anything a
 * provider returns as a link is checked against the same list before it is downloaded.
 */
import { aiError, kindForStatus } from "./errors";
import { PROVIDER_HOSTS, type Provider } from "./registry";

export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export function allowedUrl(provider: Provider, url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw aiError("rejected_input", "The provider returned an address that is not valid.");
  }
  if (parsed.protocol !== "https:" || !PROVIDER_HOSTS[provider].includes(parsed.hostname) || parsed.username || parsed.password) {
    throw aiError("rejected_input", "The provider returned an address outside its own service, so it was not opened.");
  }
  return parsed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A request to a provider. Retries only what is safe to retry: a connection that failed before the
 * provider answered, and 429 or 5xx answers to requests marked `idempotent` (reads and polls). A
 * generation request is never retried here: its outcome must be reconciled instead.
 */
export async function providerFetch(provider: Provider, url: string, init: RequestInit & { timeoutMs: number; idempotent?: boolean; retries?: number }): Promise<Response> {
  const target = allowedUrl(provider, url);
  const attempts = init.idempotent ? Math.max(1, (init.retries ?? 2) + 1) : 1;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    const outer = init.signal;
    const onAbort = () => controller.abort();
    outer?.addEventListener("abort", onAbort);
    try {
      const response = await fetch(target, { ...init, signal: controller.signal, redirect: "error" });
      if (response.ok) return response;
      const kind = kindForStatus(response.status);
      if (init.idempotent && (kind === "rate_limited" || kind === "outage" || kind === "timeout") && attempt < attempts - 1) {
        last = aiError(kind, undefined, response.status);
        continue;
      }
      throw aiError(kind, undefined, response.status);
    } catch (error) {
      if ((error as { kind?: string }).kind) throw error;
      if (outer?.aborted) throw aiError("cancelled");
      // Aborted by our own timer, or the connection dropped. For a request that is not idempotent the
      // provider may have received it: that is uncertain, not a failure to retry.
      const timedOut = controller.signal.aborted;
      last = aiError(init.idempotent ? (timedOut ? "timeout" : "outage") : "uncertain");
      if (!init.idempotent) throw last;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  }
  throw last ?? aiError("outage");
}

/** Reads a JSON body, refusing anything absurdly large. */
export async function readJson<T>(response: Response, maxBytes = 64 * 1024 * 1024): Promise<T> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw aiError("rejected_input", "The provider's answer was too large to read.");
  try {
    return (await response.json()) as T;
  } catch {
    throw aiError("invalid_output");
  }
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}
