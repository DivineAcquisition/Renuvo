import { describe, expect, it } from "vitest";

import { templates } from "../../../scripts/auth-emails.mjs";
import { codeOf, paramOf, problemOf, retryable } from "./errors";
import { meets, policyFrom, requirements, splitName } from "./password";
import { AUTH, invitePath, inviteTokenIn, isAuthPath, safeNext, SIGNED_OUT_ONLY, withNext } from "./routes";

describe("where a person may be sent after signing in", () => {
  it("keeps a plain path inside the workspace or to an invitation", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app/approvals?tab=mine#top")).toBe("/app/approvals?tab=mine#top");
    expect(safeNext("/invite/abc.def")).toBe("/invite/abc.def");
  });

  it("drops anything that leaves the app", () => {
    for (const bad of ["https://evil.example", "http://evil.example/app", "//evil.example/app", "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "data:text/html,x", "evil.example/app", "app", " /app", "/app\n/x", "/app\u0000"]) {
      expect(safeNext(bad), bad).toBeNull();
    }
  });

  it("drops paths outside the allowed sections, including look-alikes", () => {
    for (const bad of ["/", "/login", "/signup", "/auth/callback", "/c/offer/abc", "/apple", "/application", "/invite", "/invite/", "/invited/abc", "/api/x", "/app/../login"]) {
      expect(safeNext(bad), bad).toBeNull();
    }
  });

  it("treats nothing, and something absurdly long, as no destination", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext("")).toBeNull();
    expect(safeNext(`/app/${"a".repeat(600)}`)).toBeNull();
  });

  it("carries only a safe destination on a sign-in address", () => {
    expect(withNext(AUTH.login, "/app/settings")).toBe("/login?next=%2Fapp%2Fsettings");
    expect(withNext(AUTH.signup, "/invite/abc.def")).toBe("/signup?next=%2Finvite%2Fabc.def");
    expect(withNext(AUTH.login, "https://evil.example")).toBe("/login");
    expect(withNext(AUTH.login, null)).toBe("/login");
  });

  it("finds an invitation on the way through sign-in, and nothing else", () => {
    expect(inviteTokenIn(invitePath("abc.def"))).toBe("abc.def");
    expect(inviteTokenIn("/invite/abc.def?x=1")).toBe("abc.def");
    expect(inviteTokenIn("/app")).toBeNull();
    expect(inviteTokenIn("https://evil.example/invite/abc")).toBeNull();
  });

  it("knows which pages belong to signing in", () => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/auth/check-email", "/auth/verify", "/auth/error", "/auth/password-updated", "/invite/abc", "/sign-in", "/sign-up/x"]) expect(isAuthPath(path), path).toBe(true);
    for (const path of ["/", "/app", "/c/offer/abc", "/login-help", "/authors", "/invited", "/signup-now"]) expect(isAuthPath(path), path).toBe(false);
    expect(SIGNED_OUT_ONLY).toEqual(["/login", "/signup", "/forgot-password"]);
  });
});

describe("words for what went wrong", () => {
  const thrown = (code: string, extra: Record<string, unknown> = {}) => ({ status: 422, errors: [{ code, message: "RAW provider message", longMessage: "RAW long message", ...extra }] });

  it("reads the first code out of what the service returned", () => {
    expect(codeOf(thrown("form_password_incorrect"))).toBe("form_password_incorrect");
    expect(codeOf({ code: "network_error" })).toBe("network_error");
    expect(codeOf(null)).toBeNull();
    expect(codeOf("oops")).toBeNull();
    expect(paramOf(thrown("x", { meta: { paramName: "current_password" } }))).toBe("current_password");
  });

  it("answers a wrong password and a missing account with the same sentence", () => {
    const wrong = problemOf(thrown("form_password_incorrect"));
    const missing = problemOf(thrown("form_identifier_not_found"));
    expect(wrong.message).toBe(missing.message);
    expect(wrong.kind).toBe("credentials");
    expect(wrong.field).toBeUndefined();
  });

  it("never passes the service's own text through", () => {
    for (const code of ["form_password_incorrect", "form_identifier_exists", "form_password_pwned", "form_code_incorrect", "too_many_requests", "user_locked", "something_new_and_unknown"]) {
      const problem = problemOf(thrown(code));
      expect(problem.message).not.toMatch(/RAW|clerk/i);
      expect(problem.message.length).toBeGreaterThan(10);
    }
  });

  it("ties a problem to its field when it has one", () => {
    expect(problemOf(thrown("form_identifier_exists")).field).toBe("email");
    expect(problemOf(thrown("form_password_length_too_short")).field).toBe("password");
    expect(problemOf(thrown("form_code_incorrect")).field).toBe("code");
    expect(problemOf(thrown("form_password_validation_failed", { meta: { paramName: "current_password" } }))).toMatchObject({ field: "currentPassword", kind: "credentials" });
  });

  it("tells a failure of the request from a refusal", () => {
    expect(problemOf(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(problemOf({ status: 503, errors: [] }).kind).toBe("network");
    expect(problemOf({ status: 429, errors: [] }).kind).toBe("rate");
    expect(retryable(problemOf(new TypeError("Failed to fetch")))).toBe(true);
    expect(retryable(problemOf(thrown("form_password_incorrect")))).toBe(false);
  });
});

describe("the password rules", () => {
  const policy = policyFrom({ min_length: 15, max_length: 0, require_uppercase: false, require_lowercase: false, require_numbers: true, require_special_char: false, disable_hibp: false })!;

  it("are read from the service's settings, and never guessed", () => {
    expect(policy).toMatchObject({ minLength: 15, maxLength: 0, requireNumbers: true, refusesBreached: true });
    expect(policyFrom(null)).toBeNull();
    expect(policyFrom({})).toBeNull();
    expect(policyFrom({ min_length: "8" })).toBeNull();
  });

  it("are shown as lines that tick off", () => {
    expect(requirements(policy, "short").map((row) => [row.key, row.met])).toEqual([["length", false], ["number", false]]);
    expect(requirements(policy, "a-long-enough-password-1").every((row) => row.met)).toBe(true);
    expect(requirements(policy, "x")[0].label).toBe("At least 15 characters");
  });

  it("count what was typed exactly, spaces included", () => {
    expect(meets(policy, "  spaces count 1  ")).toBe(true);
    expect(meets(policy, "tooshort1")).toBe(false);
    expect(meets(null, "anything")).toBe(true);
    expect(meets(null, "")).toBe(false);
  });

  it("split a full name without losing any of it", () => {
    expect(splitName("  Maria   de la Cruz ")).toEqual({ firstName: "Maria", lastName: "de la Cruz" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitName("")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("the sign-in emails", () => {
  const set = templates("https://app.example.test") as { slug: string; subject: string; html: string; text: string }[];

  it("cover confirmation, reset and the security notices", () => {
    expect(set.map((row) => row.slug)).toEqual(["verification_code", "reset_password_code", "password_changed", "primary_email_address_changed", "new_device_sign_in", "account_locked"]);
  });

  it("are Selestial's, with no other product named", () => {
    for (const row of set) {
      expect(`${row.subject} ${row.html} ${row.text}`, row.slug).not.toMatch(/clerk/i);
      expect(row.subject, row.slug).toMatch(/Selestial/);
      expect(row.html, row.slug).toContain("SELESTIAL");
    }
  });

  it("carry the code where the service puts one, in the page and in plain text", () => {
    for (const slug of ["verification_code", "reset_password_code"]) {
      const row = set.find((item) => item.slug === slug)!;
      expect(row.subject).toContain("{{otp_code}}");
      expect(row.html).toContain("{{otp_code}}");
      expect(row.text).toContain("{{otp_code}}");
    }
  });

  it("never state how long a code lasts", () => {
    for (const row of set.filter((item) => item.slug.endsWith("_code"))) expect(`${row.html} ${row.text}`, row.slug).not.toMatch(/\b\d+\s*(minute|hour|day)s?\b/i);
  });

  it("have one button at most, and the same address written out in the plain text", () => {
    for (const row of set) {
      const links = [...row.html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((match) => match[1]);
      const addresses = new Set(links);
      expect(addresses.size, row.slug).toBeLessThanOrEqual(1);
      for (const address of addresses) {
        expect(address.startsWith("https://app.example.test/")).toBe(true);
        expect(row.text).toContain(address);
      }
    }
  });

  it("have no buttons at all without the workspace's address, instead of a broken one", () => {
    for (const row of templates(null) as { html: string }[]) expect(row.html).not.toMatch(/<a\s/);
  });
});
