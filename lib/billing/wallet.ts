import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables, Enums } from "@/types/database";

export type Wallet = Tables<"wallets">;
export type WalletTransaction = Tables<"wallet_transactions">;
export type WalletTxnType = Enums<"wallet_txn_type">;

export type UpdateWalletSettingsInput = {
  autoReloadEnabled: boolean;
  thresholdCents: number;
  amountCents: number;
};

/** The org's wallet (balance + settings). RLS-scoped read. */
export async function getWallet(orgId: string): Promise<Wallet | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load wallet: ${error.message}`);
  }

  return (data as Wallet | null) ?? null;
}

/** Ledger rows for an org, newest first, optionally filtered by type. */
export async function getWalletLedger(
  orgId: string,
  options: { type?: WalletTxnType; limit?: number } = {}
): Promise<WalletTransaction[]> {
  const supabase = await createClient();
  let query = supabase
    .from("wallet_transactions")
    .select("*")
    .eq("organization_id", orgId);

  if (options.type) query = query.eq("type", options.type);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (error) {
    throw new Error(`Failed to load wallet ledger: ${error.message}`);
  }

  return (data ?? []) as WalletTransaction[];
}

/**
 * Update auto-reload settings via the owner-gated update_wallet_settings RPC.
 * Balance is never touched here (and is not user-writable anywhere).
 */
export async function updateWalletSettings(
  orgId: string,
  input: UpdateWalletSettingsInput
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_wallet_settings", {
    p_org_id: orgId,
    p_auto_reload_enabled: input.autoReloadEnabled,
    p_reload_threshold: input.thresholdCents,
    p_reload_amount: input.amountCents,
  });

  if (error) {
    throw new Error(`Failed to update wallet settings: ${error.message}`);
  }
}

// GSM-7 default alphabet + extension table (extension chars cost 2 septets).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

/**
 * Estimate the number of SMS segments a body will use.
 *  - GSM-7: 160 single / 153 per concatenated segment (extension chars = 2).
 *  - UCS-2 (any non-GSM char, e.g. emoji): 70 single / 67 concatenated.
 * Pure util for cost preview — the carrier is the source of truth at send time.
 */
export function estimateSegments(body: string): number {
  let isGsm7 = true;
  let septets = 0;
  for (const char of body) {
    if (GSM7_BASIC.includes(char)) {
      septets += 1;
    } else if (GSM7_EXTENDED.includes(char)) {
      septets += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (isGsm7) {
    if (septets === 0) return 1;
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }

  // UCS-2: count UTF-16 code units (emoji surrogate pairs count as 2).
  const units = body.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
