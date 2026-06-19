"use server";

import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type OnboardingResult = { error: string } | undefined;

export async function completeOnboarding(
  _prev: OnboardingResult,
  formData: FormData
): Promise<OnboardingResult> {
  const name = String(formData.get("name") ?? "").trim();
  const verticalKey = String(formData.get("vertical") ?? "cleaning");
  if (!name) return { error: "Enter your business name." };

  const supabase = await createClient();

  // create org + owner membership via the security-definer RPC (Prompt 2)
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 6);

  const { data: orgId, error } = await supabase.rpc("create_organization", {
    org_name: name,
    org_slug: slug,
  });
  if (error || !orgId) {
    return { error: error?.message ?? "Could not create organization." };
  }

  // set the chosen vertical
  const { data: vertical } = await supabase
    .from("verticals")
    .select("id")
    .eq("key", verticalKey)
    .single();
  if (vertical) {
    await supabase
      .from("organizations")
      .update({ vertical_id: (vertical as { id: string }).id })
      .eq("id", orgId);
  }

  // remember active org
  (await cookies()).set("active_org", orgId as string, {
    path: "/",
    httpOnly: true,
  });

  redirect("/dashboard");
}
