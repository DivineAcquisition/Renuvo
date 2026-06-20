/**
 * Renuvo knows its own message flow, so it pre-builds the campaign. The tenant
 * never has to understand 10DLC — we describe OUR consent + messaging model.
 * Sample messages are pulled from the tenant's actual templates so they match
 * what carriers will see in traffic.
 *
 * ISV (Renuvo sends on behalf of tenants): use case is AGENTS_FRANCHISES and the
 * messageFlow describes how the END USERS (homeowners) opt in — not the tenant.
 */
export function buildCampaignDefaults(args: {
  businessName: string;
  sampleActivation: string; // rendered post_payment_activation template
  sampleOffer: string; // rendered conversion_offer template
}) {
  return {
    usecase: "AGENTS_FRANCHISES",
    description:
      `Messages sent by ${args.businessName} via the Renuvo platform: appointment ` +
      `confirmations, visit reminders, and offers to set up recurring service, to ` +
      `customers who completed a service and opted in to text messages.`,
    // TCR requires the END-USER (homeowner) opt-in described, not the tenant's.
    messageFlow:
      `End users (the business's customers) opt in by checking an SMS consent box ` +
      `on the recurring-service signup page after a completed job, or by providing ` +
      `written consent at the time of booking. Consent is never a condition of ` +
      `purchase. STOP and HELP keywords are honored on all messages.`,
    sample1: args.sampleActivation,
    sample2: args.sampleOffer,
    optinKeywords: "START,YES,SUBSCRIBE",
    helpKeywords: "HELP,INFO",
    helpMessage: `${args.businessName}: For help, reply or contact us. Reply STOP to unsubscribe.`,
    optoutKeywords: "STOP,UNSUBSCRIBE,CANCEL,END,QUIT",
    embeddedLink: true, // the capture-page link
    embeddedPhone: false,
  };
}
