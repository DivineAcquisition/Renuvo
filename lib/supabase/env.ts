/**
 * Public Supabase env. Next only inlines NEXT_PUBLIC_* when the property name
 * is a static identifier — never look them up from a dynamic array.
 */
function firstPresent(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function supabaseUrl(): string {
  return firstPresent(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return firstPresent(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}

export function requireSupabaseBrowserEnv(): { url: string; key: string } {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url, key };
}
