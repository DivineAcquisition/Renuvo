/**
 * Electronic signing, behind one interface. No production signing provider is connected: the only
 * adapter is a test double selected with SIGNATURE_PROVIDER=mock, and the product says "not connected"
 * everywhere else instead of pretending. Drafting, storage, PDF export and externally signed uploads work
 * without a provider.
 *
 * The rules this layer keeps, whatever provider is plugged in:
 *  - a request names one exact version and its hash, and is refused if the text has moved;
 *  - a provider's report is believed only after its signature checks out (webhook.ts / http.ts);
 *  - a report delivered twice changes nothing the second time (event id);
 *  - "sent" is not "delivered", and "delivered" is not "signed";
 *  - every required signer must be reported signed before the agreement is Signed.
 *
 * Adding a provider means implementing SigningProvider and naming it in `signingProvider()`; nothing else
 * in the workflow changes.
 */
export type SignerInput = { role: string; name: string; email: string; order: number };

export type CreateRequest = {
  agreementId: string;
  version: number;
  hash: string;
  title: string;
  markdown: string;
  signers: SignerInput[];
  expiresAt: number;
  idempotencyKey: string;
};

export type ProviderResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; problem: string; retryable: boolean };

export interface SigningProvider {
  name: string;
  /** Creates the request and starts delivery. The provider owns the signing page and the signatures. */
  createRequest(request: CreateRequest): Promise<ProviderResult<{ providerRequestId: string }>>;
  withdraw(providerRequestId: string): Promise<ProviderResult>;
  remind(providerRequestId: string, signerEmail: string): Promise<ProviderResult>;
  /** The completed document exactly as the provider holds it, with any evidence summary it offers. */
  fetchSigned(providerRequestId: string): Promise<ProviderResult<{ bytes: Uint8Array; contentType: string; evidence?: string }>>;
}

// ── The test double ──────────────────────────────────────────────────────────────────────────────

type MockRecord = { providerRequestId: string; request: CreateRequest; withdrawn: boolean; reminders: string[] };
export const mockSigning: { requests: MockRecord[]; fail: "none" | "create" | "withdraw" | "fetch" } = { requests: [], fail: "none" };

export function resetMockSigning() {
  mockSigning.requests.length = 0;
  mockSigning.fail = "none";
}

const mock: SigningProvider = {
  name: "mock-signing",
  async createRequest(request) {
    if (mockSigning.fail === "create") return { ok: false, problem: "The signing service did not accept the request.", retryable: true };
    const again = mockSigning.requests.find((row) => row.request.idempotencyKey === request.idempotencyKey);
    if (again) return { ok: true, providerRequestId: again.providerRequestId };
    const providerRequestId = `mock-sign-${mockSigning.requests.length + 1}`;
    mockSigning.requests.push({ providerRequestId, request, withdrawn: false, reminders: [] });
    return { ok: true, providerRequestId };
  },
  async withdraw(providerRequestId) {
    if (mockSigning.fail === "withdraw") return { ok: false, problem: "The signing service could not withdraw the request.", retryable: true };
    const row = mockSigning.requests.find((entry) => entry.providerRequestId === providerRequestId);
    if (!row) return { ok: false, problem: "The signing service has no such request.", retryable: false };
    row.withdrawn = true;
    return { ok: true };
  },
  async remind(providerRequestId, signerEmail) {
    const row = mockSigning.requests.find((entry) => entry.providerRequestId === providerRequestId);
    if (!row) return { ok: false, problem: "The signing service has no such request.", retryable: false };
    row.reminders.push(signerEmail);
    return { ok: true };
  },
  async fetchSigned(providerRequestId) {
    if (mockSigning.fail === "fetch") return { ok: false, problem: "The signed copy is not available yet.", retryable: true };
    const row = mockSigning.requests.find((entry) => entry.providerRequestId === providerRequestId);
    if (!row) return { ok: false, problem: "The signing service has no such request.", retryable: false };
    return { ok: true, bytes: new TextEncoder().encode(row.request.markdown), contentType: "text/markdown", evidence: "Test double: no real signature evidence." };
  },
};

export type SigningStatus = { configured: boolean; provider: string | null; testMode: boolean; why: string };

export function signingStatus(): SigningStatus {
  const name = process.env.SIGNATURE_PROVIDER?.trim().toLowerCase();
  if (!name) return { configured: false, provider: null, testMode: false, why: "No e-signature provider is connected. You can draft, approve, export a PDF, and upload a document signed elsewhere." };
  if (name === "mock") return { configured: true, provider: mock.name, testMode: true, why: "A test stand-in is selected. No real signature can come from it." };
  return { configured: false, provider: null, testMode: false, why: `SIGNATURE_PROVIDER names "${name}", but no adapter for it is built.` };
}

export function signingProvider(): SigningProvider | null {
  return process.env.SIGNATURE_PROVIDER?.trim().toLowerCase() === "mock" ? mock : null;
}

// ── Webhook ──────────────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = ["delivered", "viewed", "signed", "declined", "completed", "expired", "bounced", "failed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type ProviderEvent = { eventId: string; requestId: string; type: EventType; signerEmail?: string; at: number; problem?: string };

/** The body a provider adapter delivers, checked field by field. Anything else is not an event. */
export function parseEvent(body: string): ProviderEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const { eventId, requestId, type, signerEmail, at, problem } = row;
  if (typeof eventId !== "string" || !eventId || eventId.length > 200) return null;
  if (typeof requestId !== "string" || !requestId || requestId.length > 200) return null;
  if (typeof type !== "string" || !(EVENT_TYPES as readonly string[]).includes(type)) return null;
  if (signerEmail !== undefined && (typeof signerEmail !== "string" || signerEmail.length > 200)) return null;
  return { eventId, requestId, type: type as EventType, signerEmail: typeof signerEmail === "string" ? signerEmail.trim().toLowerCase() : undefined, at: typeof at === "number" && Number.isFinite(at) ? at : Date.now(), problem: typeof problem === "string" ? problem.slice(0, 300) : undefined };
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 of the body, as "sha256=<hex>". */
export async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))}`;
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only for a body signed with the deployment's secret. With no secret set, nothing is believed. */
export async function verifyBody(secret: string | undefined, header: string | null, body: string): Promise<boolean> {
  if (!secret?.trim() || !header) return false;
  return sameString(await signBody(secret.trim(), body), header.trim());
}
