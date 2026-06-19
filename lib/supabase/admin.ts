import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Guard: this client bypasses RLS and must NEVER load in the browser.
if (typeof window !== "undefined") {
  throw new Error("admin.ts (service-role) was imported in the browser.");
}

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
