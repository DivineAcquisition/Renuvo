/**
 * The sign-in service answers with codes. People read words. This turns one into the other, and
 * never passes a raw message, a stack trace or the service's own name through to the screen.
 */

export type AuthProblem = {
  /** What to show. */
  message: string;
  /** The field the problem belongs to, when it belongs to one. */
  field?: "email" | "password" | "code" | "name" | "newPassword" | "currentPassword";
  /** What kind of problem, for the screen to react to. */
  kind: "credentials" | "exists" | "password_policy" | "code" | "rate" | "locked" | "network" | "session" | "reverify" | "setup" | "unknown";
};

type Loose = { code?: unknown; status?: unknown; message?: unknown; errors?: unknown; meta?: unknown; retryAfter?: unknown };

/** The first code inside whatever the service threw or returned. */
export function codeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const loose = error as Loose;
  if (Array.isArray(loose.errors) && loose.errors.length > 0) {
    const first = loose.errors[0] as Loose;
    if (typeof first?.code === "string") return first.code;
  }
  return typeof loose.code === "string" ? loose.code : null;
}

/** Which input the first problem is about, when the service says ("current_password", "email_address"). */
export function paramOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const errors = (error as Loose).errors;
  const meta = Array.isArray(errors) && errors.length > 0 ? ((errors[0] as Loose).meta as { paramName?: unknown; param_name?: unknown } | undefined) : undefined;
  const name = meta?.paramName ?? meta?.param_name;
  return typeof name === "string" ? name : null;
}

function statusOf(error: unknown): number | null {
  const status = (error as Loose | null)?.status;
  return typeof status === "number" ? status : null;
}

const INVALID_SIGN_IN = "That email and password do not match an account. Check both and try again.";

const BY_CODE: Record<string, AuthProblem> = {
  // Signing in. A missing account and a wrong password read the same, on purpose.
  form_identifier_not_found: { message: INVALID_SIGN_IN, kind: "credentials" },
  form_password_incorrect: { message: INVALID_SIGN_IN, kind: "credentials" },
  strategy_for_user_invalid: { message: INVALID_SIGN_IN, kind: "credentials" },
  form_password_or_identifier_incorrect: { message: INVALID_SIGN_IN, kind: "credentials" },
  user_locked: { message: "Too many attempts. This account is locked for a while to keep it safe. Try again later, or reset your password.", kind: "locked" },
  form_password_compromised: { message: "This password has appeared in a known data breach, so it can no longer be used. Reset your password to continue.", field: "password", kind: "password_policy" },

  // Creating an account.
  form_identifier_exists: { message: "An account with this email already exists. Sign in instead, or reset your password if you have forgotten it.", field: "email", kind: "exists" },
  form_param_format_invalid: { message: "That does not look right. Check it and try again.", kind: "unknown" },
  form_param_nil: { message: "Something is missing. Fill in every field and try again.", kind: "unknown" },

  // Passwords.
  form_password_pwned: { message: "This password has appeared in a known data breach. Choose a different one.", field: "password", kind: "password_policy" },
  form_password_length_too_short: { message: "That password is too short.", field: "password", kind: "password_policy" },
  form_password_length_too_long: { message: "That password is too long.", field: "password", kind: "password_policy" },
  form_password_not_strong_enough: { message: "That password is too easy to guess. Make it longer or less predictable.", field: "password", kind: "password_policy" },
  form_password_no_uppercase: { message: "Add an uppercase letter to the password.", field: "password", kind: "password_policy" },
  form_password_no_lowercase: { message: "Add a lowercase letter to the password.", field: "password", kind: "password_policy" },
  form_password_no_number: { message: "Add a number to the password.", field: "password", kind: "password_policy" },
  form_password_no_special_char: { message: "Add a symbol to the password.", field: "password", kind: "password_policy" },
  form_password_validation_failed: { message: "That password does not meet the requirements.", field: "password", kind: "password_policy" },
  form_new_password_matches_current: { message: "The new password must be different from the current one.", field: "newPassword", kind: "password_policy" },

  // Codes sent by email.
  form_code_incorrect: { message: "That code is not right. Check the newest email and try again.", field: "code", kind: "code" },
  verification_failed: { message: "Too many wrong codes. Ask for a new code and try again.", field: "code", kind: "code" },
  verification_expired: { message: "That code has expired. Ask for a new one.", field: "code", kind: "code" },
  verification_already_verified: { message: "This email is already confirmed.", kind: "code" },

  // Being asked too often.
  too_many_requests: { message: "Too many requests in a short time. Wait a minute and try again.", kind: "rate" },
  rate_limit_exceeded: { message: "Too many requests in a short time. Wait a minute and try again.", kind: "rate" },

  // Sessions.
  session_exists: { message: "You are already signed in.", kind: "session" },
  identifier_already_signed_in: { message: "You are already signed in.", kind: "session" },
  authentication_invalid: { message: "Your session has ended. Sign in again.", kind: "session" },
  session_reverification_required: { message: "Confirm your password to continue.", kind: "reverify" },

  // Changing email.
  form_identifier_exists__email_address: { message: "That email is already used by another account.", field: "email", kind: "exists" },

  // Setup gaps. The person cannot fix these; the screen says so plainly.
  captcha_invalid: { message: "The security check did not pass. Reload the page and try again.", kind: "unknown" },
  sign_up_mode_restricted: { message: "New accounts are not open on this deployment yet.", kind: "setup" },
  sign_up_restricted_waitlist: { message: "New accounts are not open on this deployment yet.", kind: "setup" },
};

/** Words for whatever went wrong. Unknown problems get one honest sentence, never the raw text. */
export function problemOf(error: unknown): AuthProblem {
  const code = codeOf(error);
  // A wrong current password comes back as a failed check on that one input, not as a sign-in refusal.
  if (paramOf(error) === "current_password" && (code === "form_password_validation_failed" || code === "form_password_incorrect")) {
    return { message: "The current password is not right.", field: "currentPassword", kind: "credentials" };
  }
  if (code && BY_CODE[code]) return BY_CODE[code];
  const status = statusOf(error);
  if (status === 429) return BY_CODE.too_many_requests;
  if (code === "network_error" || (error instanceof TypeError && /fetch|network/i.test(String((error as Error).message)))) {
    return { message: "Could not reach the sign-in service. Check your connection and try again.", kind: "network" };
  }
  if (status !== null && status >= 500) return { message: "The sign-in service is having trouble right now. Try again in a moment.", kind: "network" };
  return { message: "That did not go through. Try again.", kind: "unknown" };
}

/** True when the problem is one a retry can fix without the person changing anything. */
export function retryable(problem: AuthProblem): boolean {
  return problem.kind === "network" || problem.kind === "rate" || problem.kind === "unknown";
}
