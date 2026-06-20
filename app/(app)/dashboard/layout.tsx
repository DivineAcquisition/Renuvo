import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getOnboardingState } from "@/lib/onboarding/state";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const active = await getActiveOrg();
  if (!active) redirect("/onboarding"); // authed but no org yet

  // Nudge unfinished setup, but never hard-block the dashboard.
  const onboarding = await getOnboardingState();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="font-display text-lg font-bold">Renuvo™</span>
          <span className="text-sm text-muted-foreground">
            / {active.org.name}
          </span>
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
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
      <main className="p-6">{children}</main>
    </div>
  );
}
