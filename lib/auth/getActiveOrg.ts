import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export type ActiveOrg = {
  org: { id: string; name: string; slug: string; vertical_id: string | null };
  role: "owner" | "staff";
  memberships: { organization_id: string; role: "owner" | "staff" }[];
};

/**
 * Resolves the current user's active organization + role.
 * Returns null if not authenticated OR the user has no membership yet
 * (caller redirects null → /onboarding).
 */
export async function getActiveOrg(): Promise<ActiveOrg | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rows } = await supabase
    .from("memberships")
    .select(
      "organization_id, role, created_at, organizations(id, name, slug, vertical_id)"
    )
    .order("created_at", { ascending: true });

  if (!rows || rows.length === 0) return null;

  const cookieStore = await cookies();
  const selected = cookieStore.get("active_org")?.value;
  const chosen = rows.find((r) => r.organization_id === selected) ?? rows[0];

  return {
    org: chosen.organizations as unknown as ActiveOrg["org"],
    role: chosen.role as "owner" | "staff",
    memberships: rows.map((r) => ({
      organization_id: r.organization_id,
      role: r.role as "owner" | "staff",
    })),
  };
}
