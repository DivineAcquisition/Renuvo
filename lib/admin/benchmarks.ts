import { createClient } from "@/lib/supabase/server";

async function rpc<T>(fn: string): Promise<T[]> {
  const supabase = await createClient();
  // fn is a dynamic name; the typed client only accepts known literals, so we
  // call through a loosened signature. The in-DB function self-guards (admin + k≥5).
  const call = supabase.rpc as unknown as (
    name: string
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await call(fn);
  if (error) return [];
  return (data ?? []) as T[];
}

export const getConversionByVertical = () =>
  rpc<{
    vertical: string;
    org_count: number;
    median_conversion_pct: number;
  }>("bench_conversion_by_vertical");

export const getTtrByVertical = () =>
  rpc<{ vertical: string; org_count: number; median_ttr_days: number }>(
    "bench_ttr_by_vertical"
  );

export const getIntentMix = () =>
  rpc<{ intent: string; occurrences: number; org_count: number }>(
    "bench_intent_mix"
  );

export const getCancellationReasons = () =>
  rpc<{ reason: string; occurrences: number; org_count: number }>(
    "bench_cancellation_reasons"
  );

export const getRetentionEffectiveness = () =>
  rpc<{
    metric: string;
    numerator: number;
    denominator: number;
    rate_pct: number;
    org_count: number;
  }>("bench_retention_effectiveness");
