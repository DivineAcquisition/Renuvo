/** How Dispatch works for a company. The Owner's values, with these defaults until they choose. */
import type { Doc } from "../../_generated/dataModel";
import { userError } from "../errors";

export type DispatchSettings = { offerWindowMinutes: number; travelBufferMinutes: number; lookAheadDays: number };

export const DISPATCH_DEFAULTS: DispatchSettings = { offerWindowMinutes: 120, travelBufferMinutes: 30, lookAheadDays: 7 };

export const DISPATCH_LIMITS = {
  offerWindowMinutes: { min: 15, max: 48 * 60 },
  travelBufferMinutes: { min: 0, max: 240 },
  lookAheadDays: { min: 1, max: 30 },
} as const;

export function dispatchSettings(company: Pick<Doc<"companies">, "dispatch">): DispatchSettings {
  return company.dispatch ?? DISPATCH_DEFAULTS;
}

const WORDS: Record<keyof DispatchSettings, string> = {
  offerWindowMinutes: "The time a cleaner has to answer",
  travelBufferMinutes: "The time kept between two jobs",
  lookAheadDays: "How far ahead Dispatch looks",
};

export function checkedSettings(input: DispatchSettings): DispatchSettings {
  for (const key of Object.keys(DISPATCH_LIMITS) as (keyof DispatchSettings)[]) {
    const { min, max } = DISPATCH_LIMITS[key];
    const value = input[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw userError(`${WORDS[key]} must be a whole number from ${min} to ${max}.`);
    }
  }
  return { offerWindowMinutes: input.offerWindowMinutes, travelBufferMinutes: input.travelBufferMinutes, lookAheadDays: input.lookAheadDays };
}
