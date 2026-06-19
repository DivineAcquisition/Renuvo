import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Platform secret key. Used for: Connect OAuth, AND charging tenants for wallet
// reloads on the PLATFORM account. For acting on a CONNECTED account, pass
// { stripeAccount: org.stripe_account_id } per-call (Prompt 12/18).
//
// The key can live in either place:
//   1) the STRIPE_SECRET_KEY env var (Vercel), or
//   2) Supabase Vault (read server-side via the service-role get_secret RPC).
// Env wins; Vault is the fallback so the key can be managed entirely in Supabase.
// Built LAZILY (never at import time) so a missing key can't fail `next build`.
//
// The SDK's TS types only describe the latest API version, so the pinned version
// is bridged past the narrow literal type.
type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>["apiVersion"];

let _client: Stripe | null = null;
let _keyPromise: Promise<string | null> | null = null;

async function resolveSecretKey(): Promise<string | null> {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_secret", {
      p_name: "STRIPE_SECRET_KEY",
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Lazily build the platform Stripe client (key from env or Supabase Vault). */
export async function getStripe(): Promise<Stripe> {
  if (_client) return _client;
  if (!_keyPromise) _keyPromise = resolveSecretKey();
  const key = await _keyPromise;
  if (!key) {
    _keyPromise = null; // allow a later retry
    throw new Error("STRIPE_SECRET_KEY not found in env or Supabase Vault.");
  }
  _client = new Stripe(key, {
    apiVersion: "2024-06-20" as unknown as StripeApiVersion,
  });
  return _client;
}
