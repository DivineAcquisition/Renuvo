/**
 * Called once a payment is recorded for a messageable customer.
 * Prompt 15 implements this: schedule the post-payment activation + conversion
 * sequence (respecting sms_sendable + wallet funds). Stubbed so recordPayment
 * compiles and the trigger path is testable end-to-end now.
 */
export async function onPaymentRecorded(args: {
  orgId: string;
  customerId: string;
  jobId: string;
}) {
  // TODO (Prompt 15): enqueue activation sequence via the conversion engine.
  console.log("[onPaymentRecorded] queued conversion for", args);
}
