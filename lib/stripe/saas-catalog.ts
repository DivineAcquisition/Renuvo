import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * Resolve (and lazily create) the platform-account Stripe Price for a SaaS plan.
 *
 * The seed migration leaves `stripe_price_id` null — historically that forced a
 * manual "create the Price in the Dashboard, paste the id into the DB" step, which
 * blocked every subscribe attempt. Instead we self-provision: create a Product +
 * recurring Price the first time a plan is needed, then cache both ids on the row.
 *
 * Idempotency comes from a deterministic `lookup_key` (`renuvo_saas_<plan>`), so
 * even if the cached id is lost (DB reset / account switch) we reuse the existing
 * Price rather than spawning duplicates.
 */
export async function ensurePlanPrice(planId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("subscription_plans")
    .select("id, name, price_cents, currency, stripe_price_id, stripe_product_id")
    .eq("id", planId)
    .single();
  if (!plan) throw new Error(`subscription_plan ${planId} not found`);

  const stripe = await getStripe();
  const lookupKey = `renuvo_saas_${plan.id}`;

  // 1) trust the cached id, but verify it still exists (guards account swaps)
  if (plan.stripe_price_id) {
    try {
      const price = await stripe.prices.retrieve(plan.stripe_price_id);
      if (price && price.active) return price.id;
    } catch {
      /* stale id — fall through and re-resolve */
    }
  }

  // 2) reuse an existing Price by lookup_key before creating anything
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) {
    await admin
      .from("subscription_plans")
      .update({
        stripe_price_id: existing.data[0].id,
        stripe_product_id:
          typeof existing.data[0].product === "string"
            ? existing.data[0].product
            : existing.data[0].product?.id ?? plan.stripe_product_id,
      })
      .eq("id", plan.id);
    return existing.data[0].id;
  }

  // 3) ensure the Product, then create the recurring monthly Price
  let productId = plan.stripe_product_id as string | null;
  if (productId) {
    try {
      await stripe.products.retrieve(productId);
    } catch {
      productId = null;
    }
  }
  if (!productId) {
    const product = await stripe.products.create({
      name: `Renuvo ${plan.name}`,
      metadata: { renuvo_plan_id: plan.id, scope: "platform_saas" },
    });
    productId = product.id;
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: plan.price_cents,
    currency: plan.currency ?? "usd",
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    metadata: { renuvo_plan_id: plan.id },
  });

  await admin
    .from("subscription_plans")
    .update({ stripe_price_id: price.id, stripe_product_id: productId })
    .eq("id", plan.id);

  log.info("saas.price_provisioned", { event: "saas_price_provisioned", planId });
  return price.id;
}
