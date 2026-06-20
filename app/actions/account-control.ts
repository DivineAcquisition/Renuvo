"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { modifyPlan } from "@/lib/stripe/plan-modify";
import { getCardUpdateUrl } from "@/lib/winback/links";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { revalidatePath } from "next/cache";

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function changePlanTerms(
  planId: string,
  input: {
    newPriceCents?: number;
    newCadenceProfileId?: string;
    prorate: "create_prorations" | "none" | "always_invoice";
  }
) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can change account terms." };
  const actorId = await currentUserId();
  const res = await modifyPlan({
    orgId: active.org.id,
    planId,
    actorId: actorId ?? undefined,
    ...input,
  });
  revalidatePath(`/dashboard/plans/${planId}`);
  return res;
}

export async function addAccountNote(
  planId: string,
  body: string,
  pinned = false
) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  if (!body.trim()) return { error: "Empty note." };
  const admin = createAdminClient();
  const authorId = await currentUserId();
  await admin.from("account_notes").insert({
    organization_id: active.org.id,
    recurring_plan_id: planId,
    author_id: authorId,
    body: body.trim(),
    pinned,
  });
  revalidatePath(`/dashboard/plans/${planId}`);
  return { ok: true };
}

export async function toggleNotePin(noteId: string, pinned: boolean) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin
    .from("account_notes")
    .update({ pinned })
    .eq("id", noteId)
    .eq("organization_id", active.org.id);
  return { ok: true };
}

/**
 * Trigger a secure card-update for a homeowner. The owner NEVER types a card —
 * we send the customer a self-update link via the guarded path (if consented),
 * otherwise hand the owner a copy-able link. Renuvo never sees card data.
 */
export async function requestPaymentUpdate(planId: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can request a payment update." };
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("recurring_plans")
    .select("customer_id, customers(full_name, phone, sms_sendable)")
    .eq("id", planId)
    .eq("organization_id", active.org.id)
    .single();
  if (!plan) return { error: "Plan not found." };

  const link = getCardUpdateUrl(planId);
  const cust = plan.customers as unknown as {
    full_name: string | null;
    phone: string | null;
    sms_sendable: boolean;
  } | null;

  let sent = false;
  if (cust?.sms_sendable && cust.phone) {
    const first = (cust.full_name ?? "there").trim().split(/\s+/)[0] || "there";
    const res = await sendGuardedSms({
      orgId: active.org.id,
      customerId: plan.customer_id,
      toPhone: cust.phone,
      body: `Hi ${first}, please update your card to keep your service going: ${link}`,
      eventType: "message_sent",
      meta: { reason: "payment_update_request" },
    });
    sent = res.ok;
  }

  const authorId = await currentUserId();
  await admin.from("plan_change_log").insert({
    organization_id: active.org.id,
    recurring_plan_id: planId,
    actor_id: authorId,
    actor_kind: "owner",
    change_type: "payment",
    new_value: { action: "update_requested", sent },
  });

  revalidatePath(`/dashboard/plans/${planId}`);
  return { ok: true, sent, link };
}
