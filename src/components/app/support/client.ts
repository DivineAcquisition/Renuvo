"use client";

import { ConvexReactClient } from "convex/react";

/** The calls the record hooks make whose arguments carry the company. */
const BOUND = new Set<PropertyKey>(["watchQuery", "mutation", "action", "query"]);

/**
 * The record client for one Admin Support Session (docs/operations/03-support-sessions.md). It adds the
 * session to every call that names a company, so each request is bound to the explicit session; the
 * server checks it again every time. A browser tab in a support session has its own client: other tabs,
 * and the staff console, keep theirs and are never moved into the company.
 */
export function supportClient(url: string, sessionId: string): ConvexReactClient {
  const client = new ConvexReactClient(url);
  const bind = (args: unknown) => (args && typeof args === "object" && "companyId" in args ? { ...(args as object), supportSessionId: sessionId } : args);
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (!BOUND.has(prop)) return value.bind(target);
      // fn, args, options: only the arguments change.
      return (fn: unknown, args?: unknown, ...rest: unknown[]) => value.call(target, fn, bind(args ?? {}), ...rest);
    },
  });
}

/** The tab's support session. Session storage belongs to one tab, so other tabs never pick it up. */
const KEY = "selestial.support-session";

export function readSupportSession(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("support");
    if (fromUrl) {
      window.sessionStorage.setItem(KEY, fromUrl);
      // The address stays clean, so a copied link never carries the session.
      const url = new URL(window.location.href);
      url.searchParams.delete("support");
      window.history.replaceState(null, "", url.toString());
      return fromUrl;
    }
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearSupportSession() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}
