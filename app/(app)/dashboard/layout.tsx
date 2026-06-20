import Link from "next/link";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getOnboardingState } from "@/lib/onboarding/state";
import { getWallet } from "@/lib/billing/wallet";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const active = await getActiveOrg();
  if (!active) redirect("/onboarding"); // authed but no org yet

  // Nudge unfinished setup, but never hard-block the dashboard.
  const [onboarding, wallet] = await Promise.all([
    getOnboardingState(),
    getWallet(active.org.id),
  ]);
  const balanceCents = wallet?.balance_cents ?? 0;

  return (
    <div className="ambient-wash flex min-h-screen">
      <Sidebar orgName={active.org.name} walletBalanceCents={balanceCents} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgName={active.org.name}
          walletBalanceCents={balanceCents}
        />
        {!onboarding.completed && (
          <div className="flex items-center justify-between gap-3 border-b bg-secondary px-6 py-2 text-sm">
            <span>Your workspace setup isn&apos;t finished yet.</span>
            <Link
              href="/onboarding"
              className="font-medium text-primary underline"
            >
              Finish setup
            </Link>
          </div>
        )}
        {onboarding.hasNumber && onboarding.a2pStatus !== "approved" && (
          <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-6 py-2 text-sm text-amber-800">
            <span>
              Texts are paused until your A2P registration is approved.
            </span>
            <Link
              href="/dashboard/settings/messaging/a2p"
              className="font-medium underline"
            >
              Finish A2P
            </Link>
          </div>
        )}
        <main className="flex-1 p-6">{children}</main>
      </div>
      <Toaster position="top-right" richColors />
    </div>
  );
}
