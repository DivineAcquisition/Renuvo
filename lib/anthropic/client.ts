import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

// Current Sonnet for fast, cheap, high-quality SMS personalization.
export const SMS_MODEL = "claude-sonnet-4-6";

// The API key can live in either place:
//  1) the ANTHROPIC_API_KEY env var (Vercel), or
//  2) Supabase Vault (read server-side via the service-role get_secret RPC).
// Env wins; Vault is the fallback so the key can be managed entirely in Supabase.
let _client: Anthropic | null = null;
let _keyPromise: Promise<string | null> | null = null;

async function resolveApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_secret", {
      p_name: "ANTHROPIC_API_KEY",
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Lazily build the Anthropic client, resolving the key from env or Supabase
 * Vault. Never constructs at import time, so a missing key can't fail the build;
 * generation falls back to the deterministic template if this throws.
 */
export async function getAnthropicClient(): Promise<Anthropic> {
  if (_client) return _client;
  if (!_keyPromise) _keyPromise = resolveApiKey();
  const apiKey = await _keyPromise;
  if (!apiKey) {
    _keyPromise = null; // allow a later retry
    throw new Error("ANTHROPIC_API_KEY not found in env or Supabase Vault.");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}
