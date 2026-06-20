import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/dashboard"); // not a platform admin → bounce

  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-4">
        <span className="font-display text-lg font-bold">
          Renuvo — Platform Benchmarks
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          internal · anonymized · k≥5
        </span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
