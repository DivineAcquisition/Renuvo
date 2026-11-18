import { afterEach, describe, expect, it, vi } from "vitest";

async function load(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "");
  else vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", value);
  return (await import("./auth.config")).default.providers;
}

describe("which sign-in services the record accepts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts one instance, or both while sign-in moves, and none when switched off", async () => {
    expect(await load("https://clerk.selestial.io/")).toEqual([{ domain: "https://clerk.selestial.io", applicationID: "convex" }]);
    expect(await load(" https://clerk.selestial.io , https://first-opossum-325.clerk.accounts.dev")).toEqual([
      { domain: "https://clerk.selestial.io", applicationID: "convex" },
      { domain: "https://first-opossum-325.clerk.accounts.dev", applicationID: "convex" },
    ]);
    expect(await load("none")).toEqual([]);
    expect(await load(undefined)).toEqual([]);
  });

  it("refuses an address with a path or without https", async () => {
    await expect(load("https://clerk.selestial.io/x")).rejects.toThrow(/CLERK_JWT_ISSUER_DOMAIN/);
    await expect(load("https://clerk.selestial.io,http://other.dev")).rejects.toThrow(/CLERK_JWT_ISSUER_DOMAIN/);
  });
});
