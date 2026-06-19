import { scheduleConversionSequence } from "./engine";

/**
 * Called once a payment is recorded for a messageable customer (Prompt 12).
 * Schedules the post-payment conversion sequence — consent-gated + idempotent
 * inside scheduleConversionSequence (Prompt 16).
 */
export async function onPaymentRecorded(args: {
  orgId: string;
  customerId: string;
  jobId: string;
}) {
  await scheduleConversionSequence(args);
}

/**
 * Called when a customer replies to an SMS (inbound webhook, Prompt 13).
 * Prompt 18 implements this: classify intent (interested / objection / question),
 * generate + send a reply via sendGuardedSms, advance the plan if accepted.
 */
export async function onInboundMessage(args: {
  orgId: string;
  customerId: string;
  text: string;
}) {
  // TODO (Prompt 18): classify intent + respond via the agent.
  console.log("[onInboundMessage]", args);
}
