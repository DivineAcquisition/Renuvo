import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Enums } from "@/types/database";

export type WalletTxnType = Enums<"wallet_txn_type">;

export type ChargeResult =
  | {
      ok: true;
      balanceAfterCents: number;
      chargeCents: number;
      reloadNeeded: boolean;
    }
  | {
      ok: false;
      reason: string;
      balanceAfterCents?: number;
      requiredCents?: number;
      reloadNeeded?: boolean;
    };

export type CreditResult = { ok: boolean; balanceAfterCents?: number };

// ============================================================================
// SEND-GATE CONTRACT (enforced fully in Prompt 22 guardrails)
// ----------------------------------------------------------------------------
// Before ANY SMS leaves, the send path MUST pass, in order:
//   1) customer.sms_sendable === true        (consent gate, Prompt 4)
//   2) chargeForSend(...) returns { ok: true } (funds gate, this prompt)
//
// If (2) returns reason 'insufficient_funds': BLOCK the send, fire
// triggerAutoReload(orgId), and DO NOT retry until the wallet is credited.
// Never send first and bill later — the debit happens before the send.
// ============================================================================

/**
 * Charge the wallet for a send (SERVICE-ROLE only). Calls debit_wallet, which
 * atomically locks the wallet, debits at the org's rate, and writes a ledger
 * row with margin. Returns the verdict — on insufficient funds it does NOT
 * debit and signals `reloadNeeded`.
 */
export async function chargeForSend(
  orgId: string,
  segments: number,
  reference?: string,
  meta?: Json
): Promise<ChargeResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("debit_wallet", {
    p_org_id: orgId,
    p_segments: segments,
    p_reference: reference ?? undefined,
    p_meta: meta ?? undefined,
  });

  if (error) {
    return { ok: false, reason: `debit_failed: ${error.message}` };
  }

  const verdict = (data ?? {}) as Record<string, unknown>;
  if (verdict.ok === true) {
    return {
      ok: true,
      balanceAfterCents: Number(verdict.balance_after_cents ?? 0),
      chargeCents: Number(verdict.charge_cents ?? 0),
      reloadNeeded: Boolean(verdict.reload_needed),
    };
  }

  return {
    ok: false,
    reason: String(verdict.reason ?? "unknown"),
    balanceAfterCents:
      verdict.balance_after_cents != null
        ? Number(verdict.balance_after_cents)
        : undefined,
    requiredCents:
      verdict.required_cents != null
        ? Number(verdict.required_cents)
        : undefined,
    reloadNeeded: Boolean(verdict.reload_needed),
  };
}

/**
 * Credit the wallet AFTER a successful Stripe top-up (SERVICE-ROLE only).
 * The Stripe charge itself is wired in Prompt 13/14; this only records the
 * credit + ledger row atomically.
 */
export async function creditFromReload(
  orgId: string,
  amountCents: number,
  reference?: string,
  type: WalletTxnType = "credit_reload"
): Promise<CreditResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("credit_wallet", {
    p_org_id: orgId,
    p_amount_cents: amountCents,
    p_type: type,
    p_reference: reference ?? undefined,
  });

  if (error) {
    throw new Error(`Failed to credit wallet: ${error.message}`);
  }

  const verdict = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(verdict.ok),
    balanceAfterCents:
      verdict.balance_after_cents != null
        ? Number(verdict.balance_after_cents)
        : undefined,
  };
}

/**
 * TODO (Prompt 13 — Stripe Connect + saved card):
 * When a debit verdict has reloadNeeded === true and auto-reload is enabled,
 * charge the wallet's saved card for `reload_amount_cents` via Stripe, then call
 * creditFromReload() with the resulting charge id. Stubbed until Stripe lands.
 */
export async function triggerAutoReload(_orgId: string): Promise<void> {
  throw new Error("triggerAutoReload not implemented (Prompt 13 — Stripe).");
}
