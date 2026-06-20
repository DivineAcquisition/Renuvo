import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { cancelStripeSubscription } from "@/lib/stripe/recurring";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: due } = await admin
    .from("organizations")
    .select("id, platform_subscription_id, stripe_account_id")
    .lte("deletion_scheduled_for", new Date().toISOString())
    .is("deleted_at", null);

  let torn = 0;
  for (const org of due ?? []) {
    try {
      log.info("deletion.teardown.start", { orgId: org.id });

      // 1) cancel the Renuvo SaaS subscription (platform account)
      const platformSub = (org as { platform_subscription_id?: string | null })
        .platform_subscription_id;
      if (platformSub) {
        try {
          const stripe = await getStripe();
          await stripe.subscriptions.cancel(platformSub);
        } catch (e) {
          log.warn("deletion.platform_sub", { error: (e as Error)?.message });
        }
      }

      // 2) cancel each ACTIVE recurring plan on the CONNECTED account
      const { data: plans } = await admin
        .from("recurring_plans")
        .select("id, stripe_subscription_id")
        .eq("organization_id", org.id)
        .eq("status", "active");
      for (const p of plans ?? []) {
        if (p.stripe_subscription_id) {
          try {
            await cancelStripeSubscription(org.id, p.stripe_subscription_id);
          } catch (e) {
            log.warn("deletion.connected_sub", {
              error: (e as Error)?.message,
            });
          }
        }
        await admin.rpc("change_plan_status", {
          p_plan: p.id,
          p_status: "cancelled",
          p_reason: "account_deletion",
        });
      }

      // 3) (Telnyx number release / A2P deactivation handled manually for now —
      //    TCR consent records are retained per law regardless.)

      // 4) disconnect the Stripe connected account pointer
      await admin
        .from("organizations")
        .update({ stripe_account_id: null })
        .eq("id", org.id);

      // 5) anonymize all customers + scrub message bodies
      const now = new Date().toISOString();
      await admin
        .from("customers")
        .update({
          full_name: "Deleted Customer",
          phone: null,
          email: null,
          sms_consent: false,
          opted_out: true,
          opted_out_at: now,
          deleted_at: now,
          anonymized_at: now,
          anonymized_reason: "account_deletion",
        })
        .eq("organization_id", org.id)
        .is("deleted_at", null);
      await admin
        .from("events")
        .update({ body: "[deleted]" })
        .eq("organization_id", org.id)
        .not("body", "is", null);

      // 6) RETAIN: consent_records, financial_entries, settings_audit (untouched)

      // 7) revoke member access + mark the org deleted
      await admin.from("memberships").delete().eq("organization_id", org.id);
      await admin
        .from("organizations")
        .update({ deleted_at: now })
        .eq("id", org.id);

      torn++;
      log.info("deletion.teardown.done", { orgId: org.id });
    } catch (e) {
      // halt THIS org (leave unmarked → retried next run) and alert via logs
      log.error("deletion.teardown.failed", {
        orgId: org.id,
        error: (e as Error)?.message,
      });
    }
  }

  return NextResponse.json({ ok: true, torn });
}
