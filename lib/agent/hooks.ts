import { scheduleConversionSequence } from "./engine";
import { handleInboundMessage } from "./respond";
import { canRunAgent } from "@/lib/billing/entitlements";

/**
 * Called once a payment is recorded for a messageable customer (Prompt 12).
 * Schedules the post-payment conversion sequence — consent-gated + idempotent
 * inside scheduleConversionSequence (Prompt 16). Skipped if the org's SaaS
 * subscription is delinquent (plan gating, Prompt 30).
 */
export async function onPaymentRecorded(args: {
  orgId: string;
  customerId: string;
  jobId: string;
}) {
  if (!(await canRunAgent(args.orgId))) return;
  await scheduleConversionSequence(args);
}

/**
 * Called when a customer replies to an SMS (inbound webhook, Prompt 13).
 * Classifies intent, cancels the canned sequence, and replies via the guarded
 * path (Prompt 19). STOP is handled upstream in the webhook and never gets here.
 */
export async function onInboundMessage(args: {
  orgId: string;
  customerId: string;
  text: string;
  externalId?: string;
}) {
  await handleInboundMessage(args);
}
