import { userError } from "../errors";
import { startOfLocalDay } from "../time";

/**
 * "2027-03-02" on the company's clock, as the instant that day begins. Kept in its own module so the
 * tool lists that tools.ts gathers (cleanerTools and friends) can use it without importing tools.ts
 * back, which would leave their arrays undefined while the bundle starts up.
 */
export function localDay(date: string, timezone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw userError(`"${date}" is not a date written as YYYY-MM-DD.`);
  const noon = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (Number.isNaN(noon)) throw userError(`"${date}" is not a date.`);
  return startOfLocalDay(noon, timezone);
}
