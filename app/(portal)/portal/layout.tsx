import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import { getPortalSession, PORTAL_COOKIE } from "@/lib/portal/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Manage your service",
  robots: { index: false, follow: false },
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Branding leads with the BUSINESS (the homeowner's relationship), not Renuvo.
  let businessName = "Your service";
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const s = await getPortalSession(token);
  if (s) {
    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", s.orgId)
      .single();
    businessName = org?.name ?? businessName;
  }

  return (
    <div className="min-h-screen bg-[#f6f5fb] text-[#141221]">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-lg items-center gap-2 px-5 py-4">
          <span className="font-display text-lg font-bold tracking-tight">
            {businessName}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-5 py-6">{children}</main>
      <footer className="mx-auto max-w-lg px-5 pb-8 pt-4 text-center text-xs text-[#6b6880]">
        powered by Renuvo
      </footer>
      <Toaster position="top-center" />
    </div>
  );
}
