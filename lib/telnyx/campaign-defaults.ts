/**
 * Renuvo knows its own message flow, so it pre-builds the campaign. The tenant
 * never has to understand 10DLC — we describe OUR consent + messaging model.
 * Sample messages are pulled from the tenant's actual templates so they match
 * what carriers will see in traffic.
 */
export function buildCampaignDefaults(args: {
  businessName: string;
  sampleActivation: string; // rendered post_payment_activation template
  sampleOffer: string; // rendered conversion_offer template
}) {
  return {
    // mixed: appointment reminders (care) + recurring conversion (marketing)
    usecase: "MIXED",
    vertical: "PROFESSIONAL",
    description:
      `${args.businessName} sends appointment confirmations, visit reminders, and ` +
      `offers to set up recurring service to customers who have purchased a service ` +
      `and opted in to text messages.`,
    messageFlow:
      `Customers opt in by (a) checking an SMS consent box on the recurring-service ` +
      `signup page after a completed job, or (b) providing written consent at booking. ` +
      `No purchase is required to opt in and consent is never a condition of service.`,
    sample1: args.sampleActivation,
    sample2: args.sampleOffer,
    optinMessage:
      `You're subscribed to ${args.businessName} updates. Msg & data rates may apply. ` +
      `Reply HELP for help, STOP to cancel.`,
    optinKeywords: "",
    helpKeywords: "HELP",
    helpMessage: `${args.businessName}: For help call us or reply. Reply STOP to unsubscribe.`,
    optoutKeywords: "STOP,UNSUBSCRIBE,CANCEL,END,QUIT",
    optoutMessage: `You're unsubscribed from ${args.businessName}. No more messages will be sent.`,
    embeddedLink: true, // the capture-page link
    embeddedPhone: false,
  };
}
