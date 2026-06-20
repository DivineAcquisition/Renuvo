import { createClient } from "@/lib/supabase/server";

export type Benchmark = {
  self: number | null;
  cohort: number | null;
  k: number;
  suppressed: boolean;
};

async function callBench(
  fn: "bench_conversion" | "bench_churn" | "bench_reply_rate",
  orgId: string
): Promise<Benchmark> {
  const supabase = await createClient();
  const { data } = await supabase.rpc(fn, { p_org_id: orgId });
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    self: d.self == null ? null : Number(d.self),
    cohort: d.cohort == null ? null : Number(d.cohort),
    k: Number(d.k ?? 0),
    suppressed: Boolean(d.suppressed ?? true),
  };
}

export async function getBenchmarks(orgId: string) {
  const [conversion, churn, replyRate] = await Promise.all([
    callBench("bench_conversion", orgId),
    callBench("bench_churn", orgId),
    callBench("bench_reply_rate", orgId),
  ]);
  return { conversion, churn, replyRate };
}

export type WinningMessage = {
  template: string;
  conversion: number;
  volume: number;
};

export async function getWinningMessages(
  orgId: string
): Promise<WinningMessage[]> {
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("verticals(key)")
    .eq("id", orgId)
    .maybeSingle();
  const vertical = (org?.verticals as unknown as { key?: string } | null)?.key;
  if (!vertical) return [];
  const { data } = await supabase.rpc("intel_winning_messages", {
    p_vertical: vertical,
  });
  return (data ?? []) as WinningMessage[];
}
