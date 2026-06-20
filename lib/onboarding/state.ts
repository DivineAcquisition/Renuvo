import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";

export type OnboardingState = {
  hasOrg: boolean;
  orgId?: string;
  stripeConnected: boolean;
  hasNumber: boolean;
  a2pStatus: string;
  hasCard: boolean;
  customerCount: number;
  completed: boolean;
};

export async function getOnboardingState(): Promise<OnboardingState> {
  const active = await getActiveOrg();
  if (!active)
    return {
      hasOrg: false,
      stripeConnected: false,
      hasNumber: false,
      a2pStatus: "not_started",
      hasCard: false,
      customerCount: 0,
      completed: false,
    };

  const admin = createAdminClient();
  const [{ data: org }, { data: wallet }, { count }] = await Promise.all([
    admin
      .from("organizations")
      .select(
        "stripe_account_id, telnyx_phone_number, a2p_status, onboarding_completed_at"
      )
      .eq("id", active.org.id)
      .single(),
    admin
      .from("wallets")
      .select("stripe_payment_method_id")
      .eq("organization_id", active.org.id)
      .single(),
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", active.org.id),
  ]);

  return {
    hasOrg: true,
    orgId: active.org.id,
    stripeConnected: !!org?.stripe_account_id,
    hasNumber: !!org?.telnyx_phone_number,
    a2pStatus: org?.a2p_status ?? "not_started",
    hasCard: !!wallet?.stripe_payment_method_id,
    customerCount: count ?? 0,
    completed: !!org?.onboarding_completed_at,
  };
}
