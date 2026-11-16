/**
 * Encrypting a mailbox's refresh token at rest. AES-256-GCM with MAILBOX_TOKEN_KEY, a 32-byte key set on
 * the deployment as base64. A copy of the database alone cannot read a token. With no key set, no mailbox
 * can be connected: nothing is ever stored in the clear.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function key(): Promise<CryptoKey | null> {
  const raw = process.env.MAILBOX_TOKEN_KEY?.trim();
  if (!raw) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(raw);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function secretsConfigured(): Promise<boolean> {
  return (await key()) !== null;
}

/** `iv.ciphertext`, both base64. The additional data ties the token to one connection, so it cannot be moved to another. */
export async function seal(value: string, boundTo: string): Promise<string | null> {
  const k = await key();
  if (!k) return null;
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(boundTo) }, k, encoder.encode(value)));
  return `${toBase64(iv)}.${toBase64(sealed)}`;
}

export async function unseal(sealed: string, boundTo: string): Promise<string | null> {
  const k = await key();
  const [iv, data] = sealed.split(".");
  if (!k || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(boundTo) }, k, fromBase64(data));
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

/** A random value for an OAuth state, and its hash, which is what is stored. */
export async function randomToken(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(24)));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return toBase64(digest);
}
