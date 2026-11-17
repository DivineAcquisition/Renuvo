import { userError } from "../errors";
import { startOfLocalDay } from "../time";

/**
 * "2027-03-02" on the company's clock, as the instant that day begins. Kept in its own module so a tool
 * set can use it without importing the tool registry (convex/lib/chat/tools.ts), which imports every tool
 * set: a value imported back from the registry makes the load order matter.
 */
export function localDay(date: string, timezone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw userError(`"${date}" is not a date written as YYYY-MM-DD.`);
  const noon = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (Number.isNaN(noon)) throw userError(`"${date}" is not a date.`);
  return startOfLocalDay(noon, timezone);
}
