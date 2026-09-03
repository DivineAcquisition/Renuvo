import { Inbox } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import Logo from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { INBOX_DOMAIN } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  let address: string | null = null;
  if (membership?.organization_id) {
    const { data: inbox } = await supabase
      .from("inboxes")
      .select("address_local")
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    if (inbox?.address_local) {
      address = `${inbox.address_local}@${INBOX_DOMAIN}`;
    }
  }

  return (
    <div className="relative min-h-screen bg-[#fbfbfe]">
      <header className="border-b border-ink-950/[0.06] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" aria-label="Renuvo home">
            <Logo />
          </Link>
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Inbox className="size-6" />
        </span>
        <h1 className="mt-6 font-heading text-3xl tracking-tight text-ink-950">Your inbox is ready</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-silver">
          Forward the complaints, reviews, and texts you already get. Pattern reading lands next —
          this is the foundation.
        </p>
        {address ? (
          <p className="mt-8 rounded-2xl border border-ink-950/[0.08] bg-white px-4 py-3 font-mono text-sm text-ink-950 shadow-sm">
            {address}
          </p>
        ) : (
          <p className="mt-8 text-sm text-dim">
            Your forwarding address will appear here once the workspace finishes provisioning.
          </p>
        )}
      </main>
    </div>
  );
}
