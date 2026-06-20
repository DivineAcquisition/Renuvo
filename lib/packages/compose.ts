import { createAdminClient } from "@/lib/supabase/admin";

export type Composition = { packageId: string; addonIds: string[] };

export type ComposedLineItem = {
  kind: "package" | "addon";
  ref_id: string;
  label: string;
  price_cents: number;
};

export type ComposedPlan = {
  lineItems: ComposedLineItem[];
  subtotalCents: number;
  discountPct: number;
  totalCents: number;
  defaultCadenceKey: string;
};

/**
 * Compute the recurring total + a line-item breakdown from a selection, using
 * CURRENT menu prices. The result is snapshotted onto the plan at enrollment so
 * later menu edits never change an existing plan. Discount: per-package override
 * → falls back to the org default (offer_configs, Prompt 33). All cents.
 */
export async function composePlan(
  orgId: string,
  c: Composition
): Promise<ComposedPlan> {
  const admin = createAdminClient();
  const [{ data: pkg }, { data: addons }] = await Promise.all([
    admin
      .from("service_packages")
      .select(
        "id, name, base_price_cents, default_cadence_key, recurring_discount_pct"
      )
      .eq("id", c.packageId)
      .eq("organization_id", orgId)
      .eq("active", true)
      .single(),
    c.addonIds.length
      ? admin
          .from("service_addons")
          .select("id, name, price_cents")
          .in("id", c.addonIds)
          .eq("organization_id", orgId)
          .eq("active", true)
      : Promise.resolve({ data: [] as { id: string; name: string; price_cents: number }[] }),
  ]);
  if (!pkg) throw new Error("package_not_available");

  const lineItems: ComposedLineItem[] = [
    {
      kind: "package",
      ref_id: pkg.id,
      label: pkg.name,
      price_cents: pkg.base_price_cents,
    },
    ...(addons ?? []).map((a) => ({
      kind: "addon" as const,
      ref_id: a.id,
      label: a.name,
      price_cents: a.price_cents,
    })),
  ];
  const subtotalCents = lineItems.reduce((s, li) => s + li.price_cents, 0);

  let discountPct = pkg.recurring_discount_pct as number | null;
  if (discountPct == null) {
    const { data: offer } = await admin
      .from("offer_configs")
      .select("recurring_discount_pct")
      .eq("organization_id", orgId)
      .maybeSingle();
    discountPct = Number(offer?.recurring_discount_pct ?? 0);
  }
  const pct = discountPct ?? 0;
  const totalCents = Math.round(subtotalCents * (1 - pct / 100));

  return {
    lineItems,
    subtotalCents,
    discountPct: pct,
    totalCents,
    defaultCadenceKey: pkg.default_cadence_key,
  };
}

/** Active menu for the capture page (current prices, for client-side live total). */
export async function getActiveMenu(orgId: string) {
  const admin = createAdminClient();
  const [{ data: packages }, { data: addons }, { data: offer }] =
    await Promise.all([
      admin
        .from("service_packages")
        .select(
          "id, name, description, base_price_cents, default_cadence_key, recurring_discount_pct, sort_order"
        )
        .eq("organization_id", orgId)
        .eq("active", true)
        .order("sort_order"),
      admin
        .from("service_addons")
        .select("id, name, price_cents, sort_order")
        .eq("organization_id", orgId)
        .eq("active", true)
        .order("sort_order"),
      admin
        .from("offer_configs")
        .select("recurring_discount_pct")
        .eq("organization_id", orgId)
        .maybeSingle(),
    ]);
  return {
    packages: packages ?? [],
    addons: addons ?? [],
    orgDiscountPct: Number(offer?.recurring_discount_pct ?? 0),
  };
}
