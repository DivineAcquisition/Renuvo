import { userError } from "./errors";

/** Trims a required piece of text and refuses it when empty or too long. */
export function text(value: string, label: string, max = 200): string {
  const trimmed = value.trim();
  if (!trimmed) throw userError(`${label} is required.`);
  if (trimmed.length > max) throw userError(`${label} is too long.`);
  return trimmed;
}

export function optionalText(value: string | undefined, label: string, max = 2000): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) throw userError(`${label} is too long.`);
  return trimmed || undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return value.length <= 200 && EMAIL.test(value);
}

export function email(value: string, label = "Email"): string {
  const cleaned = value.trim().toLowerCase();
  if (!isEmail(cleaned)) throw userError(`${label} is not a valid email address.`);
  return cleaned;
}

export function optionalEmail(value: string | undefined): string | undefined {
  return value === undefined || !value.trim() ? undefined : email(value);
}

/** A point in time in milliseconds. Whole numbers only, so a fractional or absurd value never reaches a record. */
export function instant(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw userError(`${label} is not a valid time.`);
  return value;
}

/** Money is whole cents, and it is entered or computed by code, never written by a model. */
export function cents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw userError(`${label} must be a whole number of cents, zero or more.`);
  return value;
}

export function tags(values: string[], label: string, max = 30): string[] {
  const out = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (out.length > max || out.some((value) => value.length > 60)) throw userError(`${label} has too many or too long entries.`);
  return out;
}
