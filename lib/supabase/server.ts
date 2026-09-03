import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabaseBrowserEnv } from "@/lib/supabase/env";
import { fetchForSupabaseKey } from "@/lib/supabase/fetch";
import type { Database } from "@/types/database";

export const createClient = cache(async () => {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseBrowserEnv();

  const client = createServerClient<Database>(url, key, {
    global: { fetch: fetchForSupabaseKey(key) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component. Session refresh writes cookies in middleware.
        }
      },
    },
  });

  await client.auth.getUser();
  return client;
});
