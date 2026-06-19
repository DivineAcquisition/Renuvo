import nacl from "tweetnacl";

/** Telnyx signs webhooks with Ed25519 over `${timestamp}|${rawBody}`. */
export function verifyTelnyxSignature(
  rawBody: string,
  signatureB64: string,
  timestamp: string
): boolean {
  try {
    const message = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    const signature = Buffer.from(signatureB64, "base64");
    const publicKey = Buffer.from(process.env.TELNYX_PUBLIC_KEY!, "base64");
    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
  } catch {
    return false;
  }
}
