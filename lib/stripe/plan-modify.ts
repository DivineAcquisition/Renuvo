import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { intervalToStripe } from "@/lib/plans/cadence";
import { captureError } from "@/lib/observability/logger";

type Interval = "day" | "week" | "month";

/**
 * Resolve (or create) a recurring Price on the TENANT's connected account for a
 * given amount + interval. Reuses an existing matching Price to avoid price sprawl.
 */
async function ensureConnectedPrice(opts: {
  stripeAccount: string;
  productId: string;
  currency: string;
  amountCents: number;
  interval: Interval;
  intervalCount: number;
}): Promise<string> {
  const stripe = await getStripe();
  const existing = await stripe.prices.list(
    { product: opts.productId, active: true, limit: 100 },
    { stripeAccount: opts.stripeAccount }
  );
  const match = existing.data.find(
    (p) =>
      p.unit_amount === opts.amountCents &&
      p.recurring?.interval === opts.interval &&
      p.recurring?.interval_count === opts.intervalCount
  );
  if (match) return match.id;

  const created = await stripe.prices.create(
    {
      product: opts.productId,
      unit_amount: opts.amountCents,
      currency: opts.currency,
      recurring: { interval: opts.interval, interval_count: opts.intervalCount },
      metadata: { renuvo: "recurring" },
    },
    { stripeAccount: opts.stripeAccount }
  );
  return created.id;
}

export type ModifyPlanResult = { ok: true } | { error: string };

/**
 * Change a plan's price and/or cadence MID-FLIGHT on the connected-account
 * subscription, with an EXPLICIT proration behavior. Persists + logs the change.
 * All money stays on the tenant's connected account (Prompt 20/30 boundary).
 */
export async function modifyPlan(args: {
  orgId: string;
  planId: string;
  newPriceCents?: number;
  newCadenceProfileId?: string;
  prorate: "create_prorations" | "none" | "always_invoice";
  actorId?: string;
}): Promise<ModifyPlanResult> {
  const admin = createAdminClient();
  const [{ data: org }, { data: plan }] = await Promise.all([
    admin
      .from("organizations")
      .select("stripe_account_id")
      .eq("id", args.orgId)
      .single(),
    admin
      .from("recurring_plans")
      .select(
        "stripe_subscription_id, price_cents, currency, cadence_profile_id, cadence_profiles(label, interval_days)"
      )
      .eq("id", args.planId)
      .eq("organization_id", args.orgId)
      .single(),
  ]);

  const acct = (org as { stripe_account_id?: string | null } | null)
    ?.stripe_account_id;
  if (!acct || !plan?.stripe_subscription_id)
    return { error: "This account isn't billable yet." };

  const curCadence = plan.cadence_profiles as unknown as {
    label: string;
    interval_days: number;
  } | null;

  // resolve target cadence
  let intervalDays = curCadence?.interval_days ?? 30;
  let newCadenceLabel = curCadence?.label ?? null;
  let cadenceChanged = false;
  if (
    args.newCadenceProfileId &&
    args.newCadenceProfileId !== plan.cadence_profile_id
  ) {
    const { data: nc } = await admin
      .from("cadence_profiles")
      .select("label, interval_days")
      .eq("id", args.newCadenceProfileId)
      .single();
    if (!nc) return { error: "Unknown cadence." };
    intervalDays = nc.interval_days;
    newCadenceLabel = nc.label;
    cadenceChanged = true;
  }

  const amountCents = args.newPriceCents ?? plan.price_cents;
  const priceChanged = amountCents !== plan.price_cents;
  if (!priceChanged && !cadenceChanged) return { ok: true };
  if (amountCents < 0) return { error: "Invalid price." };

  const rec = intervalToStripe(intervalDays);

  try {
    const stripe = await getStripe();
    const sub = await stripe.subscriptions.retrieve(
      plan.stripe_subscription_id,
      undefined,
      { stripeAccount: acct }
    );
    const item = sub.items.data[0];
    if (!item) return { error: "Subscription has no items." };
    const price = item.price as { product?: string | { id: string } };
    const productId =
      typeof price.product === "string"
        ? price.product
        : price.product?.id;
    if (!productId) return { error: "Could not resolve product." };

    const newPriceId = await ensureConnectedPrice({
      stripeAccount: acct,
      productId,
      currency: plan.currency ?? "usd",
      amountCents,
      interval: rec.interval,
      intervalCount: rec.interval_count,
    });

    await stripe.subscriptions.update(
      plan.stripe_subscription_id,
      {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: args.prorate,
        metadata: { renuvo_plan_id: args.planId },
      },
      { stripeAccount: acct }
    );
  } catch (e) {
    captureError(e, { orgId: args.orgId, event: "plan_modify_failed" });
    return { error: "Stripe couldn't apply the change. Please try again." };
  }

  // persist
  const update: Record<string, unknown> = {};
  if (priceChanged) update.price_cents = amountCents;
  if (cadenceChanged) update.cadence_profile_id = args.newCadenceProfileId;
  await admin.from("recurring_plans").update(update).eq("id", args.planId);

  // log (one entry per dimension changed)
  const logs: Record<string, unknown>[] = [];
  if (priceChanged)
    logs.push({
      organization_id: args.orgId,
      recurring_plan_id: args.planId,
      actor_id: args.actorId ?? null,
      actor_kind: "owner",
      change_type: "price",
      old_value: { price_cents: plan.price_cents },
      new_value: { price_cents: amountCents },
    });
  if (cadenceChanged)
    logs.push({
      organization_id: args.orgId,
      recurring_plan_id: args.planId,
      actor_id: args.actorId ?? null,
      actor_kind: "owner",
      change_type: "cadence",
      old_value: { cadence_label: curCadence?.label },
      new_value: { cadence_label: newCadenceLabel },
    });
  if (logs.length) await admin.from("plan_change_log").insert(logs);

  return { ok: true };
}
