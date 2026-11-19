/**
 * Settings › Integrations: every card has something to do. Built integrations report their live state and
 * link to where they are set up; planned ones can be requested by the Owner, once, for this company only.
 *
 * @vitest-environment edge-runtime
 */
import { describe, expect, it } from "vitest";

import { INTEGRATIONS } from "../src/lib/app/integrations";
import { addMember, company, NOW, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { BUILT, INTEGRATION_IDS } from "./lib/integrations";

const BRAND = { displayName: "Alpha Cleaning", companyName: "Alpha Cleaning LLC", ein: "12-3456789", phone: "+15125550199", street: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", email: "owner@alpha.example", website: "https://alpha.example", vertical: "PROFESSIONAL" };

describe("Integrations", () => {
  it("keeps the server's list of integrations the same as the page's", () => {
    expect([...INTEGRATION_IDS].sort()).toEqual(INTEGRATIONS.map((row) => row.id).sort());
    // Every built integration on the page is one the server treats as built, and the reverse.
    const built = INTEGRATIONS.filter((row) => row.status.kind !== "planned").map((row) => row.id).sort();
    expect([...BUILT].sort()).toEqual(built);
    for (const row of INTEGRATIONS) if (row.status.kind === "available") expect(row.status.href).toMatch(/^(\/app\/settings\/|\/app\/finance\/setup$|#google$|\/app\/setup\?step=records$|\/app\/texting$)/);
  });

  it("lets the Owner request a planned integration once, and nobody else", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const office = await addMember(t, as, companyId, "office-a", "office");

    const first = await as.mutation(api.integrations.request, { companyId, integrationId: "square" });
    expect(first.repeated).toBe(false);
    expect(await as.mutation(api.integrations.request, { companyId, integrationId: "square" })).toMatchObject({ repeated: true, requestedAt: first.requestedAt });
    expect((await office.query(api.integrations.overview, { companyId })).requested).toEqual([{ integrationId: "square", requestedAt: first.requestedAt }]);

    expect(await refusal(office.mutation(api.integrations.request, { companyId, integrationId: "square" }))).toBe(NOT_ALLOWED);
    expect(await refusal(as.mutation(api.integrations.request, { companyId, integrationId: "not-a-real-one" }))).toBe(NOT_FOUND);
    expect(await refusal(as.mutation(api.integrations.request, { companyId, integrationId: "gmail" }))).toMatch(/already built/);

    // Another company sees none of it.
    const other = await company(t, "owner-b", "Beta Cleaning");
    expect((await other.as.query(api.integrations.overview, { companyId: other.companyId })).requested).toEqual([]);
    expect(await refusal(other.as.query(api.integrations.overview, { companyId }))).toBe(NOT_FOUND);
  });

  it("reports the texting number and Gmail as they really stand", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const before = await as.query(api.integrations.overview, { companyId });
    // No Google app on this test deployment: Gmail is built but not switched on. Texting is ready to request.
    expect(before.live).toMatchObject({ gmail: { state: "not_set_up", detail: null }, "texting-number": { state: "ready", detail: null } });
    // Google cards are never "connected" because a key exists: nothing was granted here.
    for (const id of ["google-drive", "google-calendar", "google-business-profile", "google-ads", "google-local-services-ads"]) expect((before.live as Record<string, { state: string }>)[id].state).toBe("not_set_up");

    const member = await t.run(async (ctx) => (await ctx.db.query("members").collect()).find((row) => row.companyId === companyId)!);
    await t.run((ctx) => ctx.db.insert("textingRequests", { companyId, phoneNumber: "+15125550100", status: "provisioning", brand: BRAND, consentWording: "Reply STOP to opt out.", requestedBy: member._id, requestedAt: NOW }));
    expect((await as.query(api.integrations.overview, { companyId })).live["texting-number"]).toEqual({ state: "in_progress", detail: null });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("textingRequests").collect())[0];
      await ctx.db.patch(row._id, { status: "active" });
      await ctx.db.insert("mailboxConnections", { companyId, provider: "gmail", address: "hiring@alpha.example", sources: [], processFrom: NOW, status: "connected", failures: 0, createdBy: member._id, createdAt: NOW } as never);
    });
    expect((await as.query(api.integrations.overview, { companyId })).live).toMatchObject({ gmail: { state: "connected", detail: "hiring@alpha.example" }, "texting-number": { state: "connected", detail: "+15125550100" } });
  });
});
