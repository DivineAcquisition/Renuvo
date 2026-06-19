/**
 * Turn a pending plan into a live one: create the Stripe subscription on the
 * connected account, generate the first N recurring job instances, send the
 * recurring_confirmation SMS, optionally write to calendar. Prompt 20 implements.
 */
export async function activateRecurringPlan(
  planId: string,
  args: { paymentMethodId: string; cadenceProfileId: string }
) {
  console.log("[activateRecurringPlan] TODO Prompt 20", planId, args);
}
