/**
 * The password rules, read from the sign-in service's own settings, so the screen explains exactly
 * what will be enforced. Nothing here invents a rule: with no settings, the screen shows no list and
 * the service's answer is explained when it comes.
 *
 * A password is never trimmed or changed. What the person typed is what is sent.
 */
export type PasswordPolicy = {
  minLength: number;
  /** 0 means no upper limit. */
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChar: boolean;
  /** The service refuses passwords found in known data breaches. */
  refusesBreached: boolean;
};

type Raw = Record<string, unknown>;

/** Reads the service's password settings. Anything unexpected gives null rather than a guess. */
export function policyFrom(settings: unknown): PasswordPolicy | null {
  if (!settings || typeof settings !== "object") return null;
  const raw = settings as Raw;
  const minLength = raw.min_length;
  if (typeof minLength !== "number" || !Number.isFinite(minLength) || minLength < 1) return null;
  return {
    minLength,
    maxLength: typeof raw.max_length === "number" && raw.max_length > 0 ? raw.max_length : 0,
    requireUppercase: raw.require_uppercase === true,
    requireLowercase: raw.require_lowercase === true,
    requireNumbers: raw.require_numbers === true,
    requireSpecialChar: raw.require_special_char === true,
    refusesBreached: raw.disable_hibp === false,
  };
}

export type Requirement = { key: string; label: string; met: boolean };

/** Each rule as a line a person can tick off while typing. */
export function requirements(policy: PasswordPolicy, password: string): Requirement[] {
  const rows: Requirement[] = [{ key: "length", label: `At least ${policy.minLength} characters`, met: [...password].length >= policy.minLength }];
  if (policy.maxLength > 0) rows.push({ key: "max", label: `No more than ${policy.maxLength} characters`, met: [...password].length <= policy.maxLength });
  if (policy.requireUppercase) rows.push({ key: "upper", label: "An uppercase letter", met: /\p{Lu}/u.test(password) });
  if (policy.requireLowercase) rows.push({ key: "lower", label: "A lowercase letter", met: /\p{Ll}/u.test(password) });
  if (policy.requireNumbers) rows.push({ key: "number", label: "A number", met: /\d/.test(password) });
  if (policy.requireSpecialChar) rows.push({ key: "symbol", label: "A symbol", met: /[^\p{L}\p{N}\s]/u.test(password) });
  return rows;
}

/** True when every rule this screen can check is met. The service still has the last word. */
export function meets(policy: PasswordPolicy | null, password: string): boolean {
  if (!policy) return password.length > 0;
  return requirements(policy, password).every((row) => row.met);
}

/** "Maria Lopez" becomes a first and a last name. One word is a first name only. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
