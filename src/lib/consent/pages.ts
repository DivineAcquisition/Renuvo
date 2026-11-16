/**
 * Where optional tracking may run at all, whatever the visitor chose. Only the public marketing pages.
 * Never: the signed-in workspace, sign-in and account recovery, invitations, the cleaner and applicant
 * task pages, the privacy and security request forms, or any address carrying a token.
 */
const ALLOWED_EXACT = new Set(["/", "/security", "/security/subprocessors", "/privacy", "/terms", "/cookies", "/messaging", "/assessment"]);

/** Query parameters that may carry a secret. An address with any of them is never tracked. */
const SECRET_PARAMS = /(^|[?&])(token|t|code|key|secret|ticket|__clerk[^=]*|invite|sig|signature)=/i;

export function trackingAllowedOn(pathname: string, search = ""): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (!ALLOWED_EXACT.has(path)) return false;
  if (search && SECRET_PARAMS.test(search.replace(/^\?/, ""))) return false;
  return true;
}

/**
 * The address a tool is told about: the path only. No query string or fragment, so a token, an email
 * address or a campaign parameter carrying personal data is never passed on.
 */
export function pageForTools(origin: string, pathname: string): string {
  return `${origin}${pathname}`;
}
