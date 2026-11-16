/**
 * The same choice, read on the server. Any server-to-server advertising or analytics event (none is
 * sent today) must ask here first, so a browser's choice cannot be bypassed from the server.
 */
import { allowed, choiceFromCookieHeader, type OptionalCategory } from "./model";
import { trackingAllowedOn } from "./pages";

export type RequestLike = { headers: { get(name: string): string | null }; url?: string };

/** The Global Privacy Control signal is the request header Sec-GPC: 1. */
export function gpcFromHeaders(headers: RequestLike["headers"]): boolean {
  return headers.get("sec-gpc")?.trim() === "1";
}

/**
 * Whether a server-side event in this category may be sent for this request. The page it came from
 * must be one where tracking may run, and the visitor's current choice must allow the category.
 */
export function serverEventAllowed(request: RequestLike, category: OptionalCategory, page: { pathname: string; search?: string }, now = Date.now()): boolean {
  if (!trackingAllowedOn(page.pathname, page.search)) return false;
  const choice = choiceFromCookieHeader(request.headers.get("cookie"));
  return allowed(category, choice, gpcFromHeaders(request.headers), now);
}
