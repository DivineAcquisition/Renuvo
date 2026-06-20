import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerSecret } from "@/lib/secrets";

/**
 * A2P consent proof. We store an HMAC of the E.164 number (keyed by a server
 * secret), not the number itself — enough to answer a carrier challenge ("did
 * this number opt in / out?") for the 4+ year retention window, without keeping
 * a live PII list after a customer is deleted.
 */
async function hmacKey(): Promise<string> {
  return (
    (await getServerSecret("CONSENT_HMAC_KEY")) ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "renuvo-consent-fallback"
  );
}

export async function hashPhone(phone: string): Promise<string> {
  const key = await hmacKey();
  return crypto.createHmac("sha256", key).update(phone.trim()).digest("hex");
}

/** Record a consent event (best-effort; never breaks the calling flow). */
export async function recordConsent(args: {
  orgId: string;
  phone: string;
  source: string;
  at?: string;
}): Promise<void> {
  try {
    if (!args.phone) return;
    const admin = createAdminClient();
    const phone_hash = await hashPhone(args.phone);
    await admin.from("consent_records").insert({
      organization_id: args.orgId,
      phone_hash,
      consent_source: args.source,
      consent_at: args.at ?? new Date().toISOString(),
    });
  } catch (e) {
    console.error("[consent] recordConsent failed:", e);
  }
}

/** Stamp opt-out on the latest consent record for this number (best-effort). */
export async function recordOptOut(args: {
  orgId: string;
  phone: string;
  at?: string;
}): Promise<void> {
  try {
    if (!args.phone) return;
    const admin = createAdminClient();
    const phone_hash = await hashPhone(args.phone);
    const at = args.at ?? new Date().toISOString();
    const { data: existing } = await admin
      .from("consent_records")
      .select("id")
      .eq("organization_id", args.orgId)
      .eq("phone_hash", phone_hash)
      .order("consent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      await admin
        .from("consent_records")
        .update({ opted_out_at: at })
        .eq("id", existing.id);
    } else {
      await admin.from("consent_records").insert({
        organization_id: args.orgId,
        phone_hash,
        consent_source: "unknown",
        consent_at: at,
        opted_out_at: at,
      });
    }
  } catch (e) {
    console.error("[consent] recordOptOut failed:", e);
  }
}
