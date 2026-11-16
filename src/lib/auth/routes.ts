/**
 * Every sign-in address, in one place, and the one rule for where a person may be sent afterwards.
 * Screens and the proxy read these: no path is written twice.
 */
export const AUTH = {
  login: "/login",
  signup: "/signup",
  checkEmail: "/auth/check-email",
  verify: "/auth/verify",
  callback: "/auth/callback",
  forgot: "/forgot-password",
  reset: "/reset-password",
  passwordUpdated: "/auth/password-updated",
  error: "/auth/error",
  invite: "/invite",
} as const;

/** Where a signed-in person lands when nothing else was asked for. */
export const AFTER_SIGN_IN = "/app";

/** The query parameter that carries where to go after signing in. */
export const NEXT_PARAM = "next";

/** The only places a "next" may point: the workspace, and an invitation. */
const ALLOWED_PREFIXES = ["/app", "/invite/"] as const;

/**
 * A destination from the address bar is never trusted. It is used only when it is a plain path
 * inside this app, under an allowed section. Anything else, including another site, a
 * protocol-relative address or a path with a backslash or control character, is dropped.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://selestial.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://selestial.invalid") return null;
  const path = url.pathname;
  const allowed = ALLOWED_PREFIXES.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) && path.length > prefix.length : path === prefix || path.startsWith(`${prefix}/`)));
  if (!allowed) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A sign-in address that remembers where the person was going. An unsafe destination is left out. */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe ? `${path}?${NEXT_PARAM}=${encodeURIComponent(safe)}` : path;
}

/** The address of an invitation. The token is the only thing in it. */
export function invitePath(token: string): string {
  return `${AUTH.invite}/${encodeURIComponent(token)}`;
}

/** The invitation token inside a "next" destination, when the person is on their way to one. */
export function inviteTokenIn(next: string | null | undefined): string | null {
  const safe = safeNext(next);
  if (!safe || !safe.startsWith(`${AUTH.invite}/`)) return null;
  const token = safe.slice(AUTH.invite.length + 1).split(/[/?#]/)[0];
  return token ? decodeURIComponent(token) : null;
}

/** Pages a signed-in person has no use for: they are sent on to where they were going. */
export const SIGNED_OUT_ONLY: readonly string[] = [AUTH.login, AUTH.signup, AUTH.forgot];

/** Every path that belongs to signing in. They live on the workspace host (src/lib/hosts.ts). */
export function isAuthPath(pathname: string): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return under(AUTH.login) || under(AUTH.signup) || under("/auth") || under(AUTH.forgot) || under(AUTH.reset) || under(AUTH.invite) || under("/sign-in") || under("/sign-up");
}
