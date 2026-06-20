import Link from "next/link";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getOnboardingState } from "@/lib/onboarding/state";
import { getWallet } from "@/lib/billing/wallet";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

async function getNotifications() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { unread: 0, items: [] };
    const admin = createAdminClient();
    const { data } = await admin
      .from("notifications")
      .select("id, title, body, link, read_at, created_at")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    const items = data ?? [];
    return {
      unread: items.filter((n) => !n.read_at).length,
      items: items.map((n) => ({
        id: n.id as string,
        title: n.title as string,
        body: (n.body as string | null) ?? null,
        link: (n.link as string | null) ?? null,
        read: !!n.read_at,
      })),
    };
  } catch {
    return { unread: 0, items: [] };
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const active = await getActiveOrg();
  if (!active) redirect("/onboarding"); // authed but no org yet

  // Nudge unfinished setup, but never hard-block the dashboard.
  const [onboarding, wallet, notifications] = await Promise.all([
    getOnboardingState(),
    getWallet(active.org.id),
    getNotifications(),
  ]);
  const balanceCents = wallet?.balance_cents ?? 0;

  return (
    <div className="ambient-wash flex min-h-screen">
      <Sidebar orgName={active.org.name} walletBalanceCents={balanceCents} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgName={active.org.name}
          walletBalanceCents={balanceCents}
          notifications={notifications}
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
