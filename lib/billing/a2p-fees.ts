import { createAdminClient } from "@/lib/supabase/admin";

// Per-tenant 10DLC cost Renuvo eats up front (priced INTO the SaaS plan).
// brand ~$4 + campaign $30 (3 mo) + enhanced vetting. Tune to live Telnyx pricing.
const REGISTRATION_FEE_CENTS = 4000; // ~$40 — confirm against Telnyx pricing

/**
 * Ensure the tenant's registration is funded before we trigger real Telnyx
 * charges (brand/campaign API calls bill Renuvo's account immediately). Model
 * choice here: the fee is baked into the SaaS plan, so we require an active plan
 * and record the absorbed fee. Mock mode is always free.
 */
export async function ensureRegistrationFunded(
  orgId: string
): Promise<{ ok: true; feeCents: number } | { ok: false; reason: string }> {
  if (process.env.A2P_MOCK_MODE === "true") return { ok: true, feeCents: 0 };

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("subscription_status")
    .eq("id", orgId)
    .single();

  const status =
    (org as { subscription_status?: string | null } | null)
      ?.subscription_status ?? "none";
  if (!["trialing", "active"].includes(status)) {
    return {
      ok: false,
      reason: "An active Renuvo plan is required to register for texting.",
    };
  }
  return { ok: true, feeCents: REGISTRATION_FEE_CENTS };
}
