function isNewApiKey(key: string): boolean {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}

/** Marketplace keys are not JWTs — keep them off Authorization: Bearer. */
export function fetchForSupabaseKey(
  supabaseKey: string,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  if (!isNewApiKey(supabaseKey)) return baseFetch;

  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get("Authorization");
    if (auth === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    if (!headers.has("apikey")) {
      headers.set("apikey", supabaseKey);
    }
    return baseFetch(input, { ...init, headers });
  };
}
