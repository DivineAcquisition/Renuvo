"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionNumber } from "@/lib/telnyx/provision";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TablesInsert } from "@/types/database";

export type OnboardingResult = { error: string } | { ok: true } | undefined;

/** Step 1 — create org + vertical (for a membership-less new user). */
export async function createOrganizationStep(
  _prev: OnboardingResult,
  formData: FormData
): Promise<OnboardingResult> {
  const name = String(formData.get("name") ?? "").trim();
  const verticalKey = String(formData.get("vertical") ?? "cleaning");
  if (!name) return { error: "Enter your business name." };

  const supabase = await createClient();
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
  if (error || !orgId)
    return { error: error?.message ?? "Could not create organization." };

  const { data: vertical } = await supabase
    .from("verticals")
    .select("id")
    .eq("key", verticalKey)
    .single();
  if (vertical)
    await supabase
      .from("organizations")
      .update({ vertical_id: vertical.id })
      .eq("id", orgId as string);

  (await cookies()).set("active_org", orgId as string, {
    path: "/",
    httpOnly: true,
  });
  revalidatePath("/onboarding");
  return { ok: true };
}

/** Step 3 — provision the sending number. */
export async function provisionNumberStep(areaCode?: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  try {
    const number = await provisionNumber(active.org.id, areaCode);
    revalidatePath("/onboarding");
    return { ok: true, number };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not get a number.",
    };
  }
}

/** Step 5 — CSV import. */
export type ImportRow = {
  full_name?: string;
  phone: string;
  email?: string;
  consent?: boolean;
};

export async function importCustomers(rows: ImportRow[]) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();

  const norm = (p: string) => {
    const d = p.replace(/[^\d]/g, "");
    if (d.length === 10) return `+1${d}`;
    if (d.length === 11 && d.startsWith("1")) return `+${d}`;
    return p.startsWith("+") ? p : null;
  };

  let imported = 0;
  let skippedInvalid = 0;
  let noConsent = 0;
  const inserts: TablesInsert<"customers">[] = [];
  for (const r of rows) {
    const phone = norm(r.phone ?? "");
    if (!phone || !/^\+[1-9]\d{1,14}$/.test(phone)) {
      skippedInvalid++;
      continue;
    }
    if (!r.consent) noConsent++;
    inserts.push({
      organization_id: active.org.id,
      phone,
      full_name: r.full_name?.trim() || null,
      email: r.email?.trim() || null,
      source: "import",
      sms_consent: !!r.consent,
      sms_consent_at: r.consent ? new Date().toISOString() : null,
      sms_consent_source: r.consent ? "import" : null,
    });
  }

  if (inserts.length) {
    const { data } = await admin
      .from("customers")
      .upsert(inserts, {
        onConflict: "organization_id,phone",
        ignoreDuplicates: true,
      })
      .select("id");
    imported = data?.length ?? 0;
  }
  revalidatePath("/onboarding");
  return { ok: true, imported, skippedInvalid, noConsent };
}

/** Finish — mark complete + go to dashboard. */
export async function finishOnboarding() {
  const active = await getActiveOrg();
  if (!active) return;
  const admin = createAdminClient();
  await admin
    .from("organizations")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", active.org.id);
  redirect("/dashboard");
}
