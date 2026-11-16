import { userError } from "../errors";

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A calendar date written YYYY-MM-DD, checked to be a real day. */
export function dateOnly(value: string, label: string): string {
  const trimmed = value.trim();
  const parsed = DATE.test(trimmed) ? new Date(`${trimmed}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) throw userError(`${label} must be a date written as YYYY-MM-DD.`);
  return trimmed;
}
