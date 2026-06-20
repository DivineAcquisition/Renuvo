import { createAdminClient } from "@/lib/supabase/admin";

const cache = new Map<string, string>();

/**
 * Resolve a server-side secret from the environment first, then Supabase Vault
 * (via the service-role get_secret RPC). Never expose to the client.
 */
export async function getServerSecret(name: string): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  if (cache.has(name)) return cache.get(name) ?? null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_secret", { p_name: name });
    if (error || !data) return null;
    const value = data as string;
    cache.set(name, value);
    return value;
  } catch {
    return null;
  }
}
