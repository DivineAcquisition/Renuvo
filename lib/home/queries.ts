import { createClient } from "@/lib/supabase/server";

export type HomeSummary = {
  setup: {
    onboarding_complete: boolean;
    stripe_connected: boolean;
    subscription_status: string;
    a2p_status: string;
    messaging_suspended: boolean;
    has_number: boolean;
    has_customers: boolean;
    wallet_balance_cents: number;
  };
  snapshot: {
    active_plans: number;
    mrr_microdollars: number;
    conversions_7d: number;
    pending_messages: number;
  };
  attention: {
    at_risk_plans: number;
    replies_need_human: number;
    failed_payments: number;
    wallet_low: boolean;
  };
};

const FALLBACK: HomeSummary = {
  setup: {
    onboarding_complete: false,
    stripe_connected: false,
    subscription_status: "none",
    a2p_status: "not_started",
    messaging_suspended: false,
    has_number: false,
    has_customers: false,
    wallet_balance_cents: 0,
  },
  snapshot: {
    active_plans: 0,
    mrr_microdollars: 0,
    conversions_7d: 0,
    pending_messages: 0,
  },
  attention: {
    at_risk_plans: 0,
    replies_need_human: 0,
    failed_payments: 0,
    wallet_low: false,
  },
};

/** One round-trip home summary. Degrades to a safe default rather than throwing
 *  the page (the post-login screen must never be a blank error). */
export async function getHomeSummary(orgId: string): Promise<HomeSummary> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_home_summary", {
      p_org_id: orgId,
    });
    if (error || !data) return FALLBACK;
    return data as unknown as HomeSummary;
  } catch {
    return FALLBACK;
  }
}
