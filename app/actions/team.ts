"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function inviteTeamMember(email: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const clean = email.trim().toLowerCase();
  if (!clean.includes("@")) return { error: "Enter a valid email." };

  const admin = createAdminClient();

  // resolve (or create) the auth user for this email
  let profileId: string | null = null;
  const { data: invited, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(clean);
  if (invited?.user) {
    profileId = invited.user.id;
  } else if (inviteErr) {
    // already a user → find their profile by email and add them
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", clean)
      .maybeSingle();
    if (!existing) return { error: inviteErr.message };
    profileId = existing.id;
  }
  if (!profileId) return { error: "Could not resolve invited user." };

  // idempotent membership add (staff)
  const { data: already } = await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", active.org.id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!already) {
    const { error } = await admin.from("memberships").insert({
      organization_id: active.org.id,
      profile_id: profileId,
      role: "staff",
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard/settings/team");
  return { ok: true };
}

export async function removeTeamMember(profileId: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();

  // guard: an org must always retain at least one owner
  const { data: target } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", active.org.id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!target) return { error: "Member not found." };

  if (target.role === "owner") {
    const { count } = await admin
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", active.org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1)
      return { error: "Can't remove the last owner of the organization." };
  }

  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("organization_id", active.org.id)
    .eq("profile_id", profileId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/settings/team");
  return { ok: true };
}
