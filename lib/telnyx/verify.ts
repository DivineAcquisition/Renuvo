import nacl from "tweetnacl";
import { getServerSecret } from "@/lib/secrets";

/** Telnyx signs webhooks with Ed25519 over `${timestamp}|${rawBody}`. */
export async function verifyTelnyxSignature(
  rawBody: string,
  signatureB64: string,
  timestamp: string
): Promise<boolean> {
  try {
    const pubKeyB64 = (await getServerSecret("TELNYX_PUBLIC_KEY")) ?? "";
    if (!pubKeyB64) return false;
    const message = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    const signature = Buffer.from(signatureB64, "base64");
    const publicKey = Buffer.from(pubKeyB64, "base64");
    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
  } catch {
    return false;
  }
}
