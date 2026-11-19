/**
 * Text permission wording shown on Selestial's own forms and recorded with each yes. One function per
 * form, used by both the screen and the server, so the words recorded are exactly the words shown. Each
 * names the business and says what carriers require of any opt-in.
 */
export function cleanerTextWording(company: string): string {
  return `Text me about my work with ${company}: job offers, schedules, reminders and onboarding. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
}
