import "server-only";

import { policyFrom, type PasswordPolicy } from "./password";

/** The sign-in service's public address, which is written inside the publishable key. */
function frontendApi(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const encoded = key?.split("_")[2];
  if (!encoded) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

/**
 * The password rules as the sign-in service has them configured right now. Read on the server and
 * kept for five minutes. If they cannot be read, the forms show no list and explain the service's
 * answer instead: a rule is never guessed.
 */
export async function passwordPolicy(): Promise<PasswordPolicy | null> {
  const base = frontendApi();
  if (!base) return null;
  try {
    const response = await fetch(`${base}/v1/environment`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { user_settings?: { password_settings?: unknown } };
    return policyFrom(body.user_settings?.password_settings);
  } catch {
    return null;
  }
}
