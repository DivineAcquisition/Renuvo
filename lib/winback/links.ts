import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCaptureUrl } from "@/lib/urls";
import { newToken } from "@/lib/capture/token";

function hmacKey(): string {
  return (
    process.env.CONSENT_HMAC_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "renuvo-winback-fallback"
  );
}

/** Stable, unforgeable token for the card-update (dunning) link. */
export function signPlanToken(planId: string): string {
  return crypto
    .createHmac("sha256", hmacKey())
    .update(`pay:${planId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyPlanToken(planId: string, token: string): boolean {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signPlanToken(planId)),
      Buffer.from(token)
    );
  } catch {
    return false;
  }
}

/** Involuntary recovery → a stable link that opens the card-update flow. */
export function getCardUpdateUrl(planId: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/pay/${planId}/${signPlanToken(planId)}`;
}

export type WinbackOffer = {
  url: string;
  priceCents: number;
  discountPct: number;
};

/**
 * Build (or reuse) a win-back capture link whose offer reflects
 * `winback_discount_pct` instead of the standard recurring discount. Base price
 * comes from the customer's prior plan; lapse customers with no plan get the
 * cadence default at $0 (price set on the capture page).
 */
export async function resolveWinbackOffer(args: {
  orgId: string;
  customerId: string;
  planId?: string;
}): Promise<WinbackOffer> {
  const admin = createAdminClient();

  const { data: offer } = await admin
    .from("offer_configs")
    .select("winback_discount_pct")
    .eq("organization_id", args.orgId)
    .maybeSingle();
  const pct = Number(
    (offer as { winback_discount_pct?: number } | null)?.winback_discount_pct ?? 0
  );

  // base price + cadence from the named plan, else the customer's latest plan
  let basePrice = 0;
  let cadenceId: string | null = null;
  const planQuery = args.planId
    ? admin
        .from("recurring_plans")
        .select("price_cents, cadence_profile_id")
        .eq("id", args.planId)
        .maybeSingle()
    : admin
        .from("recurring_plans")
        .select("price_cents, cadence_profile_id")
        .eq("organization_id", args.orgId)
        .eq("customer_id", args.customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  const { data: plan } = await planQuery;
  if (plan) {
    basePrice = (plan as { price_cents?: number }).price_cents ?? 0;
    cadenceId = (plan as { cadence_profile_id?: string }).cadence_profile_id ?? null;
  }

  if (!cadenceId) {
    const { data: org } = await admin
      .from("organizations")
      .select("vertical_id, preferred_cadence_id")
      .eq("id", args.orgId)
      .single();
    cadenceId = (org as { preferred_cadence_id?: string }).preferred_cadence_id ?? null;
    if (!cadenceId) {
      const { data: v } = await admin
        .from("verticals")
        .select("default_cadence_id")
        .eq("id", (org as { vertical_id?: string })?.vertical_id ?? "")
        .maybeSingle();
      cadenceId = (v as { default_cadence_id?: string } | null)?.default_cadence_id ?? null;
    }
  }

  const discounted = Math.max(0, Math.round(basePrice * (1 - pct / 100)));

  // reuse an active win-back link for this customer (keeps the offer stable)
  const { data: existing } = await admin
    .from("signup_links")
    .select("token")
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .eq("status", "active")
    .gt("winback_discount_pct", 0)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();
  if (existing?.token)
    return { url: buildCaptureUrl(existing.token), priceCents: discounted, discountPct: pct };

  if (!cadenceId)
    return { url: buildCaptureUrl("invalid"), priceCents: discounted, discountPct: pct };

  const token = newToken();
  await admin.from("signup_links").insert({
    organization_id: args.orgId,
    customer_id: args.customerId,
    cadence_profile_id: cadenceId,
    price_cents: discounted,
    winback_discount_pct: pct,
    token,
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });

  return { url: buildCaptureUrl(token), priceCents: discounted, discountPct: pct };
}
