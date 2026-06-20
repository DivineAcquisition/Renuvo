import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSession, PORTAL_COOKIE } from "@/lib/portal/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { Money } from "@/components/ui/money";
import { fromCents } from "@/lib/money";
import { PortalHome } from "./PortalHome";

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export default async function PortalOverview() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const s = await getPortalSession(token);
  if (!s) redirect("/access-expired");

  const admin = createAdminClient();
  const [{ data: org }, { data: plan }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, vertical_id, stripe_account_id, accent_color")
      .eq("id", s.orgId)
      .single(),
    admin
      .from("recurring_plans")
      .select(
        "id, status, price_cents, next_service_at, stripe_subscription_id, cadence_profile_id, cadence_profiles(label), service_packages(name)"
      )
      .eq("organization_id", s.orgId)
      .eq("customer_id", s.customerId)
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!plan) {
    return (
      <div className="rounded-2xl bg-white p-7 text-center shadow-sm">
        <h1 className="font-display text-xl font-bold">No active plan</h1>
        <p className="mt-2 text-sm text-[#6b6880]">
          You don&apos;t have a recurring plan with us right now.
        </p>
      </div>
    );
  }

  // cadence options for "change frequency"
  let cadences: { id: string; label: string }[] = [];
  if (org?.vertical_id) {
    const { data } = await admin
      .from("cadence_profiles")
      .select("id, label")
      .eq("vertical_id", org.vertical_id)
      .order("interval_days");
    cadences = data ?? [];
  }

  // payment method (brand + last4 only), best-effort
  let card: string | null = null;
  if (org?.stripe_account_id && plan.stripe_subscription_id) {
    try {
      const stripe = await getStripe();
      const sub = await stripe.subscriptions.retrieve(
        plan.stripe_subscription_id,
        { expand: ["default_payment_method"] },
        { stripeAccount: org.stripe_account_id }
      );
      const pm = (sub as unknown as {
        default_payment_method?: { card?: { brand?: string; last4?: string } };
      }).default_payment_method;
      if (pm?.card) card = `${pm.card.brand} ···· ${pm.card.last4}`;
    } catch {
      /* read-only nicety; ignore */
    }
  }

  // recent payments (scoped to this plan)
  const { data: payments } = await admin
    .from("financial_entries")
    .select("id, occurred_at, amount_microdollars, category")
    .eq("organization_id", s.orgId)
    .eq("recurring_plan_id", plan.id)
    .order("occurred_at", { ascending: false })
    .limit(4);

  const cadenceLabel =
    (plan.cadence_profiles as unknown as { label?: string } | null)?.label ??
    "Recurring";
  const pkgName = (plan.service_packages as unknown as { name?: string } | null)
    ?.name;
  const { data: lineItems } = await admin
    .from("plan_line_items")
    .select("id, label, price_cents")
    .eq("organization_id", s.orgId)
    .eq("recurring_plan_id", plan.id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm text-[#6b6880]">Your plan</p>
        <h1 className="mt-1 font-display text-2xl font-bold">
          {pkgName ?? cadenceLabel}
        </h1>
        <p className="mt-1 text-sm">
          {pkgName ? `${cadenceLabel} · ` : ""}
          <Money value={fromCents(plan.price_cents)} />/visit · next{" "}
          {date(plan.next_service_at)}
        </p>
        {lineItems && lineItems.length > 0 && (
          <p className="mt-1 text-xs text-[#6b6880]">
            {lineItems
              .map((li) => `${li.label} $${(li.price_cents / 100).toFixed(0)}`)
              .join(" + ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-[#f0eefc] px-2.5 py-1 font-semibold capitalize text-[#4F38FF]">
            {plan.status}
          </span>
          {card && (
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[#6b6880]">
              {card}
            </span>
          )}
        </div>
      </div>

      <PortalHome
        status={plan.status}
        cadences={cadences}
        currentCadenceId={plan.cadence_profile_id}
        accent={
          (org as { accent_color?: string | null } | null)?.accent_color ??
          "#4F38FF"
        }
      />

      {payments && payments.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="mb-2 text-sm font-semibold">Recent activity</p>
          {payments.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between border-b py-2 text-sm last:border-0"
            >
              <span className="text-[#6b6880]">
                {date(p.occurred_at)} · {p.category}
              </span>
              <Money value={Number(p.amount_microdollars)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
