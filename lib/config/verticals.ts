import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Vertical = Tables<"verticals">;
export type CadenceProfile = Tables<"cadence_profiles">;

/** A vertical with its cadence options nested (for the onboarding picker). */
export type VerticalWithCadences = Vertical & {
  cadence_profiles: CadenceProfile[];
};

/**
 * All verticals (cleaning, lawn, pool, pest) with their cadence_profiles nested.
 * Reference data is readable by any authenticated user (see RLS). Cadences are
 * ordered by interval_days ascending so pickers render shortest → longest.
 */
export async function getVerticals(): Promise<VerticalWithCadences[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("verticals")
    .select("*, cadence_profiles(*)")
    .order("display_name", { ascending: true })
    .order("interval_days", {
      ascending: true,
      referencedTable: "cadence_profiles",
    });

  if (error) {
    throw new Error(`Failed to load verticals: ${error.message}`);
  }

  return (data ?? []) as VerticalWithCadences[];
}

/**
 * The cadence options for a single vertical, ordered by interval_days ascending.
 * Feeds the cadence selector in messaging settings. `interval_days` is the
 * single source of truth for "how often" — never hardcode 7/14/30/90.
 */
export async function getCadenceProfiles(
  verticalId: string
): Promise<CadenceProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cadence_profiles")
    .select("*")
    .eq("vertical_id", verticalId)
    .order("interval_days", { ascending: true });

  if (error) {
    throw new Error(`Failed to load cadence profiles: ${error.message}`);
  }

  return (data ?? []) as CadenceProfile[];
}
