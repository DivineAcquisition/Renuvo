/** First-time setup: what an empty answer looks like, and how each "I'm not sure" is turned into words. */
import type { Context } from "./schema";

export function emptyContext(): Context {
  return { serviceAreas: "", customerKinds: [], categories: [], currentServices: "", typicalSizes: "", teamStructure: null, cleaners: null, compensation: null, typicalVisitMinutes: null, bookingsPerWeek: null, capacityPerWeek: null, notes: "", unsure: [] };
}

/** The setup fields an owner may answer "I'm not sure" to. */
export const UNSURE_FIELDS = ["serviceAreas", "typicalSizes", "teamStructure", "compensation", "typicalVisitMinutes", "bookingsPerWeek", "capacityPerWeek", "costs", "positioning"] as const;

const UNSURE_WORDS: Record<(typeof UNSURE_FIELDS)[number], string> = {
  serviceAreas: "Service area not given: research and area pricing wait until you say where you work.",
  typicalSizes: "Typical property size not given: size-based prices are checked against sample sizes in Pricing Studio instead.",
  teamStructure: "Team structure not given: each service starts with one cleaner per visit.",
  compensation: "How cleaners are paid not given: profitability leaves labor out and says so.",
  typicalVisitMinutes: "Typical cleaning time not given: templates' usual times are used and marked as estimates.",
  bookingsPerWeek: "Booking volume not given: overhead per visit cannot be worked out from monthly costs.",
  capacityPerWeek: "Capacity not given: demand pricing's busy-day rule reads the schedule instead.",
  costs: "Costs not given: prices are checked for time and staffing, not for margin.",
  positioning: "Positioning not given: recommendations stay neutral between value and premium.",
};

/** Each "I'm not sure" becomes a stated assumption or follow-up, never an invented value. */
export function assumptionsFor(context: Context): string[] {
  return context.unsure.map((key) => UNSURE_WORDS[key as keyof typeof UNSURE_WORDS] ?? `${key} not given: it is left out rather than guessed.`);
}
