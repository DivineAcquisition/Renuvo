import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Customer = Tables<"customers">;

/** Where a contact's SMS consent came from. Required whenever consent is true. */
export type ConsentSource =
  | "booking_form"
  | "import"
  | "manual"
  | "reply_optin";

export type CreateCustomerInput = {
  fullName?: string | null;
  phone: string;
  email?: string | null;
  smsConsent?: boolean;
  consentSource?: ConsentSource;
  source?: string | null;
};

// Mirrors the chk_phone_e164 DB constraint so we fail fast before the round-trip.
const E164 = /^\+[1-9]\d{1,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

/** All customers for an org, newest first. */
export async function listCustomers(orgId: string): Promise<Customer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list customers: ${error.message}`);
  }

  return (data ?? []) as Customer[];
}

/** Only customers the engine is allowed to text (sms_sendable = true). */
export async function getSendableCustomers(orgId: string): Promise<Customer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", orgId)
    .eq("sms_sendable", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load sendable customers: ${error.message}`);
  }

  return (data ?? []) as Customer[];
}

/**
 * Create a customer for an org.
 *
 * Compliance invariants enforced here (in addition to the DB constraints):
 *  - phone must be E.164.
 *  - sms_consent can NEVER be set true without a consentSource. When consent is
 *    given we stamp sms_consent_at = now() and record the source. Un-consented
 *    contacts land with sms_sendable = false (the generated column handles it).
 */
export async function createCustomer(
  orgId: string,
  input: CreateCustomerInput
): Promise<Customer> {
  const phone = input.phone?.trim();
  if (!phone || !isE164(phone)) {
    throw new Error(
      `Invalid phone "${input.phone}". Must be E.164, e.g. +13015551234.`
    );
  }

  const smsConsent = input.smsConsent === true;
  if (smsConsent && !input.consentSource) {
    throw new Error(
      "Cannot set sms_consent=true without a consentSource (compliance)."
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      organization_id: orgId,
      full_name: input.fullName ?? null,
      phone,
      email: input.email ?? null,
      source: input.source ?? null,
      sms_consent: smsConsent,
      sms_consent_at: smsConsent ? new Date().toISOString() : null,
      sms_consent_source: smsConsent ? input.consentSource ?? null : null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create customer: ${error.message}`);
  }

  return data as Customer;
}
