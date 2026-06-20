"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const SERVICES_PATH = "/dashboard/settings/services";

export async function upsertPackage(input: {
  id?: string;
  name: string;
  description?: string;
  basePriceCents: number;
  defaultCadenceKey: string;
  recurringDiscountPct?: number | null;
  sortOrder?: number;
  active?: boolean;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can edit the service menu." };
  if (!input.name.trim()) return { error: "Name is required." };
  if (!(input.basePriceCents > 0)) return { error: "Price must be positive." };
  const admin = createAdminClient();
  const row = {
    organization_id: active.org.id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    base_price_cents: Math.round(input.basePriceCents),
    default_cadence_key: input.defaultCadenceKey,
    recurring_discount_pct:
      input.recurringDiscountPct == null
        ? null
        : Math.max(0, Math.min(90, input.recurringDiscountPct)),
    sort_order: input.sortOrder ?? 0,
    active: input.active ?? true,
  };
  if (input.id)
    await admin
      .from("service_packages")
      .update(row)
      .eq("id", input.id)
      .eq("organization_id", active.org.id);
  else await admin.from("service_packages").insert(row);
  revalidatePath(SERVICES_PATH);
  return { ok: true };
}

export async function upsertAddon(input: {
  id?: string;
  name: string;
  priceCents: number;
  sortOrder?: number;
  active?: boolean;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can edit add-ons." };
  if (!input.name.trim()) return { error: "Name is required." };
  if (!(input.priceCents > 0)) return { error: "Price must be positive." };
  const admin = createAdminClient();
  const row = {
    organization_id: active.org.id,
    name: input.name.trim(),
    price_cents: Math.round(input.priceCents),
    sort_order: input.sortOrder ?? 0,
    active: input.active ?? true,
  };
  if (input.id)
    await admin
      .from("service_addons")
      .update(row)
      .eq("id", input.id)
      .eq("organization_id", active.org.id);
  else await admin.from("service_addons").insert(row);
  revalidatePath(SERVICES_PATH);
  return { ok: true };
}

/**
 * Deactivate (not hard-delete) when a package/add-on is in use, so historical
 * plan line items keep their meaning. Hard-delete only if never referenced.
 */
export async function setPackageActive(id: string, active: boolean) {
  const a = await getActiveOrg();
  if (!a || a.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin
    .from("service_packages")
    .update({ active })
    .eq("id", id)
    .eq("organization_id", a.org.id);
  revalidatePath(SERVICES_PATH);
  return { ok: true };
}

export async function setAddonActive(id: string, active: boolean) {
  const a = await getActiveOrg();
  if (!a || a.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin
    .from("service_addons")
    .update({ active })
    .eq("id", id)
    .eq("organization_id", a.org.id);
  revalidatePath(SERVICES_PATH);
  return { ok: true };
}
