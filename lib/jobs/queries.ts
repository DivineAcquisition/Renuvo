import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables, Enums } from "@/types/database";

export type Job = Tables<"jobs">;
export type JobKind = Enums<"job_kind">;
export type JobStatus = Enums<"job_status">;

export type RecordOneTimeJobInput = {
  priceCents?: number | null;
  currency?: string;
  stripePaymentIntentId: string;
  paidAt?: string | Date | null;
};

export type ListJobsFilter = {
  kind?: JobKind;
  status?: JobStatus;
};

// Postgres unique_violation — the uniq_jobs_payment_intent idempotency index.
const UNIQUE_VIOLATION = "23505";

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Look up a job by its Stripe payment intent (used for webhook idempotency). */
export async function getJobByPaymentIntent(
  orgId: string,
  paymentIntentId: string
): Promise<Job | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up job by payment intent: ${error.message}`);
  }

  return (data as Job | null) ?? null;
}

/**
 * Record a one-time job from a paid Stripe payment intent.
 *
 * Idempotent: the `stripe_payment_intent_id` is a unique key, so a webhook retry
 * never double-creates a job. We pre-check, then insert, then fall back to a
 * re-read if a concurrent insert won the race (unique violation). Called by the
 * Stripe webhook (Prompt 14) under the service-role client.
 */
export async function recordOneTimeJobFromPayment(
  orgId: string,
  customerId: string,
  input: RecordOneTimeJobInput
): Promise<Job> {
  const { stripePaymentIntentId } = input;
  if (!stripePaymentIntentId) {
    throw new Error("stripePaymentIntentId is required for idempotency.");
  }

  const existing = await getJobByPaymentIntent(orgId, stripePaymentIntentId);
  if (existing) return existing;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      organization_id: orgId,
      customer_id: customerId,
      kind: "one_time",
      price_cents: input.priceCents ?? null,
      currency: input.currency ?? "usd",
      stripe_payment_intent_id: stripePaymentIntentId,
      paid_at: toIso(input.paidAt),
    })
    .select("*")
    .single();

  if (error) {
    // Lost an idempotency race — the row now exists, so return it.
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await getJobByPaymentIntent(orgId, stripePaymentIntentId);
      if (raced) return raced;
    }
    throw new Error(`Failed to record job from payment: ${error.message}`);
  }

  return data as Job;
}

/** Jobs for an org, optionally filtered by kind/status, newest first. */
export async function listJobs(
  orgId: string,
  filter: ListJobsFilter = {}
): Promise<Job[]> {
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select("*")
    .eq("organization_id", orgId);

  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list jobs: ${error.message}`);
  }

  return (data ?? []) as Job[];
}

/**
 * STUB — real implementation lands in Prompt 20.
 *
 * Turn a paid one-time job into the parent of a recurring series, generating
 * `instances` child jobs linked via `parent_job_id` at the cadence's interval.
 * Defined now only so callers compile; do not rely on it yet.
 */
export async function convertToRecurringSeries(
  _jobId: string,
  _cadenceProfileId: string,
  _instances: number
): Promise<Job[]> {
  throw new Error("convertToRecurringSeries not implemented (Prompt 20).");
}
