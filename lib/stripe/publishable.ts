import { getServerSecret } from "@/lib/secrets";

/**
 * Resolve the Stripe PUBLISHABLE key (pk_...) server-side so the client always
 * gets a key that MATCHES the secret used to create the intent. Prefers the
 * Supabase Vault (`STRIPE_PUBLISHABLE_KEY`) — where the live keys are managed —
 * and falls back to the build-time public env var. This avoids the classic
 * "Elements renders nothing" bug caused by a missing/mismatched NEXT_PUBLIC key.
 *
 * Safe to expose to the browser (publishable keys are not secret).
 */
export async function getPublishableKey(): Promise<string | null> {
  const fromVault = await getServerSecret("STRIPE_PUBLISHABLE_KEY");
  return (
    fromVault ??
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    null
  );
}
