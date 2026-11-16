/**
 * Agreement signing, behind one interface, for when an e-signature provider is chosen. None is
 * connected: SIGNATURE_PROVIDER is unset, so Recruiter claims no signing ability and an agreement is
 * marked complete only when a person records that it was. The mock stands in for a provider in tests.
 */
export type Envelope = { template: string; signerName: string; signerEmail: string; idempotencyKey: string };

export interface SignatureProvider {
  name: string;
  /** Sends the company's own template to be signed. It writes no terms. */
  send(envelope: Envelope): Promise<{ ok: true; envelopeId: string } | { ok: false; problem: string }>;
}

export const mockEnvelopes: (Envelope & { envelopeId: string })[] = [];

const mock: SignatureProvider = {
  name: "mock-signature",
  async send(envelope) {
    const again = mockEnvelopes.find((row) => row.idempotencyKey === envelope.idempotencyKey);
    if (again) return { ok: true, envelopeId: again.envelopeId };
    const envelopeId = `mock-envelope-${mockEnvelopes.length + 1}`;
    mockEnvelopes.push({ ...envelope, envelopeId });
    return { ok: true, envelopeId };
  },
};

export function signatureProvider(): SignatureProvider | null {
  return process.env.SIGNATURE_PROVIDER?.trim().toLowerCase() === "mock" ? mock : null;
}
