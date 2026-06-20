import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { ScheduleForm } from "./ScheduleForm";

export default async function SchedulePage() {
  const active = await getActiveOrg();
  if (!active) return null;
  if (!active.org.vertical_id)
    return (
      <p className="text-sm text-muted-foreground">Set your vertical first.</p>
    );

  const supabase = await createClient();
  const [{ data: cadences }, { data: org }] = await Promise.all([
    supabase
      .from("cadence_profiles")
      .select("id, label, interval_days")
      .eq("vertical_id", active.org.vertical_id)
      .order("interval_days", { ascending: true }),
    supabase
      .from("organizations")
      .select("preferred_cadence_id")
      .eq("id", active.org.id)
      .single(),
  ]);

  return (
    <ScheduleForm
      cadences={cadences ?? []}
      current={org?.preferred_cadence_id ?? null}
      isOwner={active.role === "owner"}
    />
  );
}
