import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { ServicesView } from "./ServicesView";

export default async function ServicesSettingsPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  if (active.role !== "owner")
    return (
      <p className="text-sm text-muted-foreground">
        Only an owner can edit the service menu.
      </p>
    );

  const admin = createAdminClient();
  const [{ data: packages }, { data: addons }, { data: cadences }] =
    await Promise.all([
      admin
        .from("service_packages")
        .select(
          "id, name, description, base_price_cents, default_cadence_key, recurring_discount_pct, active, sort_order"
        )
        .eq("organization_id", active.org.id)
        .order("sort_order"),
      admin
        .from("service_addons")
        .select("id, name, price_cents, active, sort_order")
        .eq("organization_id", active.org.id)
        .order("sort_order"),
      admin
        .from("cadence_profiles")
        .select("key, label")
        .eq("vertical_id", active.org.vertical_id ?? "")
        .order("interval_days"),
    ]);

  return (
    <ServicesView
      packages={packages ?? []}
      addons={addons ?? []}
      cadences={cadences ?? []}
    />
  );
}
