import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables, Enums, Json } from "@/types/database";

export type RecurringPlan = Tables<"recurring_plans">;
export type RetentionEvent = Tables<"retention_events">;
export type PlanStatus = Enums<"plan_status">;
export type PlanRiskLevel = Enums<"plan_risk_level">;
export type RetentionEventType = Enums<"retention_event_type">;

export type CreateRecurringPlanInput = {
  customerId: string;
  originJobId?: string | null;
  cadenceProfileId: string;
  priceCents: number;
  currency?: string;
};

export type ActivatePlanInput = {
  stripeSubscriptionId?: string | null;
  startedAt?: string | Date | null;
  nextServiceAt?: string | Date | null;
};

// Postgres unique_violation — active-plan-per-customer / subscription idempotency.
const UNIQUE_VIOLATION = "23505";

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Create a plan in `pending` and log a `plan_created` retention_event — atomic
 * via the create_recurring_plan() RPC (one transaction, never desyncs).
 * The active-plan-per-customer unique index surfaces as a clear error.
 */
export async function createRecurringPlan(
  orgId: string,
  input: CreateRecurringPlanInput
): Promise<RecurringPlan> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_recurring_plan", {
    p_org: orgId,
    p_customer: input.customerId,
    p_origin_job: input.originJobId ?? null,
    p_cadence: input.cadenceProfileId,
    p_price_cents: input.priceCents,
    p_currency: input.currency ?? "usd",
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error(
        "This customer already has an active or pending plan. Cancel it before creating a new one."
      );
    }
    throw new Error(`Failed to create recurring plan: ${error.message}`);
  }

  return data as RecurringPlan;
}

/**
 * Activate a plan (attach the Stripe subscription) and log `activated` — atomic
 * via the activate_plan() RPC.
 */
export async function activatePlan(
  planId: string,
  input: ActivatePlanInput = {}
): Promise<RecurringPlan> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activate_plan", {
    p_plan: planId,
    p_stripe_subscription_id: input.stripeSubscriptionId ?? undefined,
    p_started_at: toIso(input.startedAt) ?? undefined,
    p_next_service_at: toIso(input.nextServiceAt) ?? undefined,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error(
        "That Stripe subscription is already attached to another plan."
      );
    }
    throw new Error(`Failed to activate plan: ${error.message}`);
  }

  return data as RecurringPlan;
}

/**
 * Pause / resume / cancel a plan. Stamps the matching timestamp (and
 * cancellation_reason on cancel) and writes the matching retention_event —
 * atomic via the change_plan_status() RPC.
 */
export async function changePlanStatus(
  planId: string,
  status: PlanStatus,
  reason?: string
): Promise<RecurringPlan> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_plan_status", {
    p_plan: planId,
    p_status: status,
    p_reason: reason ?? undefined,
  });

  if (error) {
    throw new Error(`Failed to change plan status: ${error.message}`);
  }

  return data as RecurringPlan;
}

/** Append a retention_event (the ledger is append-only by RLS). */
export async function recordRetentionEvent(
  orgId: string,
  planId: string,
  customerId: string,
  type: RetentionEventType,
  reason?: string,
  meta?: Json
): Promise<RetentionEvent> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("retention_events")
    .insert({
      organization_id: orgId,
      recurring_plan_id: planId,
      customer_id: customerId,
      type,
      reason: reason ?? null,
      meta: meta ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to record retention event: ${error.message}`);
  }

  return data as RetentionEvent;
}

/** All active plans for an org, newest first. */
export async function getActivePlans(orgId: string): Promise<RecurringPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_plans")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load active plans: ${error.message}`);
  }

  return (data ?? []) as RecurringPlan[];
}

/** Active plans flagged medium/high churn risk, for the retention worklist. */
export async function getAtRiskPlans(orgId: string): Promise<RecurringPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_plans")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("risk_level", ["medium", "high"])
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load at-risk plans: ${error.message}`);
  }

  return (data ?? []) as RecurringPlan[];
}
