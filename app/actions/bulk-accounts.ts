"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type BulkAction =
  | "pause"
  | "resume"
  | "cancel"
  | "adjust_price"
  | "message"
  | "request_payment_update";

/**
 * Queue a bulk operation. The worker (cron) drains it with a concurrency cap so
 * the request returns fast and Stripe isn't hammered synchronously.
 */
export async function queueBulkOperation(input: {
  action: BulkAction;
  targetIds: string[];
  params?: Record<string, unknown>;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can run bulk actions." };
  if (!input.targetIds.length) return { error: "Nothing selected." };
  if (input.targetIds.length > 1000) return { error: "Limit 1000 per batch." };
  if (input.action === "message" && !String(input.params?.body ?? "").trim())
    return { error: "Write a message first." };
  if (
    input.action === "adjust_price" &&
    !(Number(input.params?.newPriceCents) > 0)
  )
    return { error: "Set a valid price." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: op, error } = await admin
    .from("bulk_operations")
    .insert({
      organization_id: active.org.id,
      actor_id: user?.id ?? null,
      action: input.action,
      params: input.params ?? {},
      target_ids: input.targetIds,
      total: input.targetIds.length,
      status: "queued",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/dashboard/accounts");
  return { ok: true, operationId: op!.id as string };
}

export async function getBulkOperation(id: string) {
  const active = await getActiveOrg();
  if (!active) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("bulk_operations")
    .select("id, action, status, total, succeeded, failed, errors")
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .maybeSingle();
  return data;
}
