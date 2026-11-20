import { describe, expect, it } from "vitest";

import { decide, HOST_ROLES, HOST_SETTINGS, hostMap, hostName, indexable, parseOrigin, publicOrigin, roleOfHost, roleOfPath, type HostMap } from "./hosts";

const SETTINGS = {
  NEXT_PUBLIC_SITE_ORIGIN: "https://www.example.test",
  APP_ORIGIN: "https://app.example.test",
  LINK_ORIGIN: "https://link.example.test",
  ADMIN_ORIGIN: "https://admin.example.test",
  DOCS_ORIGIN: "https://docs.example.test",
  STATUS_ORIGIN: "https://status.example.test",
};
const FULL = hostMap(SETTINGS);
const get = (host: string, pathname: string, map: HostMap = FULL, search = "") => decide({ host, pathname, search, method: "GET" }, map);
const serves = (noindex: boolean) => ({ kind: "next", noindex });
const goesTo = (to: string) => ({ kind: "redirect", to });

describe("reading the settings", () => {
  it("has one setting for each host", () => {
    expect(Object.keys(HOST_SETTINGS).sort()).toEqual([...HOST_ROLES].sort());
    expect(new Set(Object.values(HOST_SETTINGS)).size).toBe(HOST_ROLES.length);
  });

  it("accepts a plain https origin and tidies it", () => {
    expect(parseOrigin(" https://App.Example.test/ ")).toBe("https://app.example.test");
    expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects anything that is not a plain origin", () => {
    for (const bad of [undefined, "", "app.example.test", "http://app.example.test", "https://app.example.test/app", "https://app.example.test?x=1", "https://user:pw@app.example.test", "ftp://app.example.test"]) {
      expect(parseOrigin(bad)).toBeNull();
    }
  });

  it("leaves out a role whose setting is missing or malformed", () => {
    expect(hostMap({})).toEqual({});
    expect(hostMap({ APP_ORIGIN: "not a url", LINK_ORIGIN: "https://link.example.test" })).toEqual({ link: "https://link.example.test" });
  });

  it("never gives one host two meanings", () => {
    const map = hostMap({ NEXT_PUBLIC_SITE_ORIGIN: "https://example.test", APP_ORIGIN: "https://www.example.test", LINK_ORIGIN: "https://example.test" });
    expect(map).toEqual({ public: "https://example.test" });
  });

  it("reads a host name from an origin or a Host header", () => {
    expect(hostName("https://App.Example.test")).toBe("app.example.test");
    expect(hostName("app.example.test:443")).toBe("app.example.test");
    expect(hostName("localhost:3000")).toBe("localhost");
  });
});

describe("which host is which", () => {
  it("knows each configured host", () => {
    expect(roleOfHost("www.example.test", FULL)).toBe("public");
    expect(roleOfHost("app.example.test", FULL)).toBe("app");
    expect(roleOfHost("link.example.test:443", FULL)).toBe("link");
    expect(roleOfHost("ADMIN.example.test", FULL)).toBe("admin");
    expect(roleOfHost("docs.example.test", FULL)).toBe("docs");
    expect(roleOfHost("status.example.test", FULL)).toBe("status");
  });

  it("treats the public site's name with and without www as the same site", () => {
    expect(roleOfHost("example.test", FULL)).toBe("public");
    expect(roleOfHost("www.example.test", hostMap({ NEXT_PUBLIC_SITE_ORIGIN: "https://example.test" }))).toBe("public");
    // Only the public site gets this: www.app.example.test is not the workspace.
    expect(roleOfHost("www.app.example.test", FULL)).toBeNull();
  });

  it("does not know local, preview or other hosts", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "project-git-branch-team.vercel.app", "other.test", "example.test.evil.test"]) {
      expect(roleOfHost(host, FULL)).toBeNull();
    }
  });
});

describe("which host a path belongs to", () => {
  it("sorts the routes that exist", () => {
    expect(roleOfPath("/")).toBe("public");
    expect(roleOfPath("/sitemap.xml")).toBe("public");
    expect(roleOfPath("/legal/privacy")).toBe("public");
    for (const path of ["/staff", "/staff/requests", "/staff/operations/billing"]) expect(roleOfPath(path)).toBe("admin");
    expect(roleOfPath("/staffing")).toBe("public");
    for (const path of ["/app", "/app/approvals", "/app/agents/dispatch/schedule", "/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/auth/check-email", "/invite/abc.def", "/sign-in", "/sign-in/factor-one", "/sign-up"]) expect(roleOfPath(path)).toBe("app");
    for (const path of ["/c", "/c/offer/abc", "/c/job/abc/photos", "/n/unsubscribe"]) expect(roleOfPath(path)).toBe("link");
    // A marketing page that only starts with the same letter stays public.
    expect(roleOfPath("/news")).toBe("public");
    for (const path of ["/robots.txt", "/icon.svg", "/favicon.ico", "/.well-known/security.txt", "/__clerk/v1/client"]) expect(roleOfPath(path)).toBe("shared");
  });

  it("does not mistake a longer word for a section", () => {
    expect(roleOfPath("/apple")).toBe("public");
    expect(roleOfPath("/careers")).toBe("public");
    expect(roleOfPath("/sign-in-help")).toBe("public");
    expect(roleOfPath("/login-help")).toBe("public");
    expect(roleOfPath("/authors")).toBe("public");
    expect(roleOfPath("/invited")).toBe("public");
  });
});

describe("with no host settings", () => {
  it("changes nothing on any host", () => {
    for (const host of ["www.example.test", "app.example.test", "admin.example.test", "localhost:3000"]) {
      for (const path of ["/", "/app", "/sign-in", "/c/offer/abc", "/robots.txt"]) expect(get(host, path, {})).toEqual(serves(false));
    }
    expect(indexable("www.example.test", {})).toBe(true);
    expect(publicOrigin({})).toBeNull();
  });
});

describe("hosts no setting names", () => {
  it("can reach every route", () => {
    for (const host of ["localhost:3000", "project-git-branch-team.vercel.app"]) {
      for (const path of ["/", "/app/approvals", "/sign-in", "/c/offer/abc", "/sitemap.xml"]) expect(get(host, path)).toEqual(serves(false));
    }
  });

  it("are not offered to search engines once the public site is set", () => {
    expect(indexable("project-git-branch-team.vercel.app", FULL)).toBe(false);
  });
});

describe("the public site", () => {
  it("serves public pages and is the only host indexed", () => {
    expect(get("www.example.test", "/")).toEqual(serves(false));
    expect(get("www.example.test", "/sitemap.xml")).toEqual(serves(false));
    expect(indexable("www.example.test", FULL)).toBe(true);
    expect(publicOrigin(FULL)).toBe("https://www.example.test");
  });

  it("sends the workspace and sign-in to the workspace host, keeping the path and query", () => {
    expect(get("www.example.test", "/app/approvals")).toEqual(goesTo("https://app.example.test/app/approvals"));
    expect(get("www.example.test", "/sign-in", FULL, "?redirect_url=%2Fapp")).toEqual(goesTo("https://app.example.test/sign-in?redirect_url=%2Fapp"));
  });

  it("sends link pages to the link host", () => {
    expect(get("www.example.test", "/c/offer/abc")).toEqual(goesTo("https://link.example.test/c/offer/abc"));
  });
});

describe("the workspace host", () => {
  it("serves the workspace and sign-in, and is not indexed", () => {
    expect(get("app.example.test", "/app/approvals")).toEqual(serves(true));
    expect(get("app.example.test", "/sign-up")).toEqual(serves(true));
    expect(indexable("app.example.test", FULL)).toBe(false);
  });

  it("opens the workspace from its root", () => {
    expect(get("app.example.test", "/")).toEqual(goesTo("https://app.example.test/app"));
  });

  it("sends public pages and link pages to their own hosts", () => {
    expect(get("app.example.test", "/legal/privacy")).toEqual(goesTo("https://www.example.test/legal/privacy"));
    expect(get("app.example.test", "/c/job/abc")).toEqual(goesTo("https://link.example.test/c/job/abc"));
  });

  it("sends the staff console to the staff host", () => {
    expect(get("app.example.test", "/staff/operations", FULL, "?x=1")).toEqual(goesTo("https://admin.example.test/staff/operations?x=1"));
    expect(get("www.example.test", "/staff")).toEqual(goesTo("https://admin.example.test/staff"));
  });
});

describe("the staff host", () => {
  it("serves the staff console, and is not indexed", () => {
    for (const path of ["/staff", "/staff/operations", "/staff/operations/attention", "/staff/companies"]) expect(get("admin.example.test", path)).toEqual(serves(true));
    expect(indexable("admin.example.test", FULL)).toBe(false);
  });

  it("opens Operations from its root", () => {
    expect(get("admin.example.test", "/")).toEqual(goesTo("https://admin.example.test/staff/operations"));
  });

  it("sends sign-in to the workspace host, remembering where staff were going", () => {
    expect(get("admin.example.test", "/login", FULL, "?next=%2Fstaff%2Foperations")).toEqual(goesTo("https://app.example.test/login?next=%2Fstaff%2Foperations"));
  });

  it("opens a support session's company workspace on the workspace host, keeping the session in the query", () => {
    expect(get("admin.example.test", "/app", FULL, "?support=abc123")).toEqual(goesTo("https://app.example.test/app?support=abc123"));
  });

  it("sends public pages to the public site and link pages to the link host", () => {
    expect(get("admin.example.test", "/legal/privacy")).toEqual(goesTo("https://www.example.test/legal/privacy"));
    expect(get("admin.example.test", "/c/offer/abc")).toEqual(goesTo("https://link.example.test/c/offer/abc"));
  });

  it("never replays a form post on another host", () => {
    expect(decide({ host: "admin.example.test", pathname: "/", method: "POST" }, FULL)).toEqual({ kind: "not_found", message: "Not found." });
    expect(decide({ host: "admin.example.test", pathname: "/app", method: "POST" }, FULL)).toEqual({ kind: "not_found", message: "Not found." });
    expect(decide({ host: "admin.example.test", pathname: "/staff/operations", method: "POST" }, FULL)).toEqual(serves(true));
  });
});

describe("the link host", () => {
  it("serves link pages only", () => {
    expect(get("link.example.test", "/c/offer/abc")).toEqual(serves(true));
    expect(get("link.example.test", "/app")).toEqual({ kind: "not_found", message: "Not found." });
    expect(get("link.example.test", "/staff")).toEqual({ kind: "not_found", message: "Not found." });
    expect(get("link.example.test", "/sign-in")).toEqual({ kind: "not_found", message: "Not found." });
    expect(get("link.example.test", "/legal/privacy")).toEqual({ kind: "not_found", message: "Not found." });
    expect(indexable("link.example.test", FULL)).toBe(false);
  });

  it("sends its bare root to the public site", () => {
    expect(get("link.example.test", "/")).toEqual(goesTo("https://www.example.test/"));
  });
});

describe("hosts that are not built", () => {
  it("show neither the public site nor the workspace", () => {
    for (const path of ["/", "/app", "/staff", "/sign-in", "/c/offer/abc", "/anything"]) {
      expect(get("docs.example.test", path)).toEqual({ kind: "not_found", message: "Not available yet." });
      expect(get("status.example.test", path)).toEqual({ kind: "not_found", message: "Not available yet." });
    }
  });

  it("still answer crawlers, and tell them to stay out", () => {
    expect(get("admin.example.test", "/robots.txt")).toEqual(serves(true));
    for (const host of ["admin.example.test", "docs.example.test", "status.example.test"]) expect(indexable(host, FULL)).toBe(false);
  });
});

describe("one page, one host", () => {
  it("never serves the same path on two configured hosts", () => {
    const hosts = ["www.example.test", "app.example.test", "link.example.test", "admin.example.test", "docs.example.test", "status.example.test"];
    for (const path of ["/", "/legal/privacy", "/sitemap.xml", "/app", "/app/schedule", "/sign-in", "/sign-up", "/c/offer/abc", "/staff", "/staff/operations"]) {
      const served = hosts.filter((host) => get(host, path).kind === "next");
      expect(served, path).toHaveLength(1);
    }
  });

  it("redirects only to configured hosts", () => {
    const origins = new Set(Object.values(FULL));
    const hosts = ["www.example.test", "app.example.test", "link.example.test", "admin.example.test"];
    for (const host of hosts) {
      for (const path of ["/", "/legal/privacy", "/app", "/sign-in", "/c/offer/abc", "/staff/operations"]) {
        const decision = get(host, path);
        if (decision.kind === "redirect") expect(origins.has(new URL(decision.to).origin)).toBe(true);
      }
    }
  });
});

describe("partly set up", () => {
  it("serves a page where it is when its own host is not set yet", () => {
    const map = hostMap({ NEXT_PUBLIC_SITE_ORIGIN: "https://www.example.test" });
    expect(get("www.example.test", "/app", map)).toEqual(serves(false));
    expect(get("www.example.test", "/c/offer/abc", map)).toEqual(serves(false));
    // A host with no setting is still unknown, so it is not restricted.
    expect(get("app.example.test", "/", map)).toEqual(serves(false));
  });

  it("keeps the staff console on the workspace host until the staff host is set", () => {
    const map = hostMap({ NEXT_PUBLIC_SITE_ORIGIN: "https://www.example.test", APP_ORIGIN: "https://app.example.test" });
    expect(get("app.example.test", "/staff/operations", map)).toEqual(serves(true));
  });

  it("gives the link host a plain not-found at its root when there is no public site to send to", () => {
    const map = hostMap({ LINK_ORIGIN: "https://link.example.test" });
    expect(get("link.example.test", "/", map)).toEqual({ kind: "not_found", message: "Not found." });
  });
});

describe("requests that are not page loads", () => {
  it("are never redirected to another host", () => {
    expect(decide({ host: "www.example.test", pathname: "/app", method: "POST" }, FULL)).toEqual({ kind: "not_found", message: "Not found." });
    expect(decide({ host: "app.example.test", pathname: "/", method: "POST" }, FULL)).toEqual({ kind: "not_found", message: "Not found." });
  });

  it("still work on the right host", () => {
    expect(decide({ host: "www.example.test", pathname: "/", method: "POST" }, FULL)).toEqual(serves(false));
    expect(decide({ host: "app.example.test", pathname: "/app/settings", method: "POST" }, FULL)).toEqual(serves(true));
  });
});
