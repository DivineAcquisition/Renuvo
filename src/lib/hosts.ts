/**
 * Which host shows what. One Vercel project answers on several hosts, so the app decides what each
 * host serves: the public site, the signed-in workspace, the link pages sent in texts, and hosts that
 * are attached but not built yet.
 *
 * Host names come from settings, never from strings in this file. A host that no setting names
 * (localhost, a preview deployment, an old domain) is left alone and can reach every route. With no
 * settings at all, nothing here changes any response.
 *
 * This is routing, not access control. Sign-in and every read and write are checked elsewhere.
 * These are pure functions: no request, no Next.js. src/proxy.ts applies them.
 */
import { isAuthPath } from "./auth/routes";

export const HOST_ROLES = ["public", "app", "link", "admin", "docs", "status"] as const;
export type HostRole = (typeof HOST_ROLES)[number];

/** The setting that names each host. Each holds an origin, such as https://app.selestial.io. */
export const HOST_SETTINGS: Record<HostRole, string> = {
  public: "NEXT_PUBLIC_SITE_ORIGIN",
  app: "APP_ORIGIN",
  link: "LINK_ORIGIN",
  admin: "ADMIN_ORIGIN",
  docs: "DOCS_ORIGIN",
  status: "STATUS_ORIGIN",
};

/** Hosts that are attached to the project but have nothing built behind them yet. */
export const UNBUILT_ROLES: readonly HostRole[] = ["admin", "docs", "status"];

/** What a person sees on a host that is not built. Admin does not say that it exists. */
const UNBUILT_MESSAGE: Record<string, string> = {
  admin: "Not found.",
  docs: "Not available yet.",
  status: "Not available yet.",
};

/** The origin configured for each role. A role with no valid setting is absent. */
export type HostMap = Partial<Record<HostRole, string>>;

type Env = Record<string, string | undefined>;

/** "https://App.Selestial.io/" becomes "https://app.selestial.io". Anything that is not a plain origin is rejected. */
export function parseOrigin(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
  return url.origin;
}

/** The host name of an origin or a Host header, lower case, without a port. */
export function hostName(value: string): string {
  const text = value.trim().toLowerCase();
  const withoutScheme = text.replace(/^[a-z]+:\/\//, "");
  return withoutScheme.split("/")[0].replace(/:\d+$/, "");
}

const withoutWww = (host: string) => host.replace(/^www\./, "");

/**
 * Reads the settings. A setting that is missing or malformed leaves its role out. If two roles name
 * the same host, the first in HOST_ROLES keeps it, so one host never has two meanings.
 */
export function hostMap(env: Env): HostMap {
  const map: HostMap = {};
  const taken = new Set<string>();
  for (const role of HOST_ROLES) {
    const origin = parseOrigin(env[HOST_SETTINGS[role]]);
    if (!origin) continue;
    const host = withoutWww(hostName(origin));
    if (taken.has(host)) continue;
    taken.add(host);
    map[role] = origin;
  }
  return map;
}

/**
 * The role of a host, or null for a host no setting names. The public site answers on its name with
 * and without "www", because the bare domain redirects to it.
 */
export function roleOfHost(host: string, map: HostMap): HostRole | null {
  const name = hostName(host);
  for (const role of HOST_ROLES) {
    const origin = map[role];
    if (!origin) continue;
    const configured = hostName(origin);
    if (name === configured) return role;
    if (role === "public" && withoutWww(name) === withoutWww(configured)) return role;
  }
  return null;
}

/** Which host a path belongs to. "shared" paths are served on every host. */
export type PathRole = "public" | "app" | "link" | "shared";

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function roleOfPath(pathname: string): PathRole {
  const path = pathname === "" ? "/" : pathname;
  // Crawler rules, icons, domain checks and Clerk's own proxy path are needed wherever the app answers.
  if (path === "/robots.txt" || path === "/icon.svg" || path === "/favicon.ico") return "shared";
  if (under(path, "/.well-known") || under(path, "/__clerk")) return "shared";
  if (under(path, "/app") || under(path, "/staff") || isAuthPath(path)) return "app";
  if (under(path, "/c")) return "link";
  return "public";
}

export type Decision =
  | { kind: "next"; noindex: boolean }
  | { kind: "redirect"; to: string }
  | { kind: "not_found"; message: string };

export type HostRequest = { host: string; pathname: string; search?: string; method?: string };

/**
 * What to do with a request. A page is served on one host only: on any other configured host it
 * redirects to the right one, or is not found.
 */
export function decide(request: HostRequest, map: HostMap): Decision {
  const role = roleOfHost(request.host, map);
  // A host no setting names: local development, previews. Everything stays reachable.
  if (role === null) return { kind: "next", noindex: false };

  const path = roleOfPath(request.pathname);
  const noindex = role !== "public";
  if (path === "shared") return { kind: "next", noindex };

  if (UNBUILT_ROLES.includes(role)) return { kind: "not_found", message: UNBUILT_MESSAGE[role] };

  const safe = request.method === undefined || request.method === "GET" || request.method === "HEAD";
  const send = (to: HostRole, pathname: string): Decision => {
    const origin = map[to];
    // The right host is not set up yet, so there is nowhere to send the person: serve it here.
    if (!origin) return { kind: "next", noindex };
    // Only a plain page load is redirected. A form post to the wrong host is refused, not replayed.
    if (!safe) return { kind: "not_found", message: "Not found." };
    return { kind: "redirect", to: `${origin}${pathname}${request.search ?? ""}` };
  };

  if (role === "public") {
    if (path === "public") return { kind: "next", noindex };
    return send(path, request.pathname);
  }

  if (role === "app") {
    if (path === "app") return { kind: "next", noindex };
    // The workspace host has no front page of its own: its root opens the workspace.
    if (request.pathname === "/" || request.pathname === "") return safe ? { kind: "redirect", to: `${map.app}/app` } : { kind: "not_found", message: "Not found." };
    return send(path, request.pathname);
  }

  // The link host serves link pages and nothing else: no marketing, no workspace.
  if (path === "link") return { kind: "next", noindex };
  if ((request.pathname === "/" || request.pathname === "") && map.public && safe) return { kind: "redirect", to: `${map.public}/` };
  return { kind: "not_found", message: "Not found." };
}

/**
 * Whether search engines may index a host. Only the public site is indexed. Before the public
 * site's host is set, this answers yes for every host, which is how the site behaved before.
 */
export function indexable(host: string, map: HostMap): boolean {
  if (!map.public) return true;
  return roleOfHost(host, map) === "public";
}

/** The public site's origin for canonical links and the sitemap, when it is set. */
export function publicOrigin(map: HostMap): string | null {
  return map.public ?? null;
}
