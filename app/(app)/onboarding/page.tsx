import { getOnboardingState } from "@/lib/onboarding/state";
import { getWallet } from "@/lib/billing/wallet";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { Wizard } from "./Wizard";

export default async function OnboardingPage() {
  const state = await getOnboardingState();
  const active = state.hasOrg ? await getActiveOrg() : null;
  const wallet = state.orgId ? await getWallet(state.orgId) : null;
  return (
    <Wizard
      state={state}
      businessName={active?.org.name ?? ""}
      walletBalanceCents={wallet?.balance_cents ?? 0}
    />
  );
}
