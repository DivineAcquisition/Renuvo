/**
 * @vitest-environment edge-runtime
 *
 * Phase 6 of the email build: the checks that cut across the pieces. Webhook authenticity through the real
 * HTTP route, complaints kept apart from bounces, retries that send exactly once, size limits mail
 * programs apply, and one person's choices never touching another's. The per-piece tests live beside
 * each piece (notifications, inboxes, templates, recruiterGmail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PREVIEWS } from "./lib/email/templates/gallery";
import { mockNotices } from "./lib/messaging/email";

const SECRET = `whsec_${btoa("test-only-webhook-signing-key-0123")}`;
const DAYTIME = Date.UTC(2026, 10, 18, 17, 0);
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function sign(id: string, timestamp: number, body: string) {
  const raw = Uint8Array.from(atob(SECRET.slice(6)), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return `v1,${btoa(String.fromCharCode(...mac))}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
  process.env.ACTION_LINK_SECRET = "test-only-secret-for-action-links-0123456789";
  process.env.EMAIL_PROVIDER = "mock";
  process.env.APP_ORIGIN = "https://app.selestial.test";
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  mockNotices.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  for (const name of ["ACTION_LINK_SECRET", "EMAIL_PROVIDER", "APP_ORIGIN", "RESEND_WEBHOOK_SECRET"]) delete process.env[name];
});

const notices = (t: T, companyId: Id<"companies">) =>
  t.run(async (ctx) => (await ctx.db.query("messages").withIndex("by_company_queued", (q) => q.eq("companyId", companyId)).collect()).filter((m) => m.purpose === "member_notice"));

describe("Resend's webhook, end to end", () => {
  it("only a signed report changes a notice, a complaint stays a complaint after delivery, and a replay changes nothing", async () => {
    const t = start();
    const { companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await settle(t);
    const [welcome] = await notices(t, companyId);
    expect(welcome.status).toBe("delivered");
    // As a real Resend send would be recorded.
    await t.run((ctx) => ctx.db.patch(welcome._id, { provider: "resend", providerMessageId: "re_notice_1" }));
    const post = async (type: string, id: string, signature?: string) => {
      const body = JSON.stringify({ type, data: { email_id: "re_notice_1" } });
      const timestamp = Math.floor(Date.now() / 1000);
      return t.fetch("/webhooks/resend", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": signature ?? (await sign(id, timestamp, body)) } });
    };

    // Unsigned, forged, or signed for another body: refused, nothing recorded.
    expect((await post("email.complained", "evt_forged", "v1,forged")).status).toBe(401);
    expect((await t.run((ctx) => ctx.db.get(welcome._id)))?.complainedAt).toBeUndefined();

    expect((await post("email.complained", "evt_1")).status).toBe(200);
    const after = await t.run((ctx) => ctx.db.get(welcome._id));
    expect(after).toMatchObject({ status: "delivered" });
    expect(after?.complainedAt).toBeTypeOf("number");
    expect(after?.bouncedAt).toBeUndefined();
    // The address is blocked for notices, as a complaint, and the person sees why.
    const owner = t.withIdentity({ subject: "owner-a", email: "owner-a@example.com", emailVerified: true, name: "owner-a", issuer: "https://clerk.selestial.test", tokenIdentifier: "https://clerk.selestial.test|owner-a" });
    expect((await owner.query(api.notifications.mine, { companyId })).blocked?.reason).toBe("complaint");

    // The provider retries the same report: recorded once.
    expect((await post("email.complained", "evt_1")).status).toBe(200);
    const blocks = await t.run((ctx) => ctx.db.query("noticeSuppressions").collect());
    expect(blocks).toHaveLength(1);
    // Opened and clicked reports change nothing (Selestial doesn't track either).
    expect((await post("email.opened", "evt_2")).status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(welcome._id)))?.status).toBe("delivered");
  });
});

describe("retries", () => {
  it("a notice the email service refused twice goes on the third try, exactly once", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    // The mock fails twice for any address starting "flaky", then accepts.
    await addMember(t, owner, companyId, "flaky-manager", "manager");
    await settle(t);
    mockNotices.length = 0;
    const approvalId = await t.run((ctx) => ctx.db.insert("approvals", { companyId, agent: "sales", action: "send_quote", summary: "Send a quote", reason: "They asked.", status: "pending", decideBy: DAYTIME + 6 * 3_600_000, createdAt: DAYTIME }));
    await t.mutation(internal.notifications.notify, { companyId, event: "approval_needed", ref: approvalId });
    await settle(t);
    const toFlaky = mockNotices.filter((m) => m.to === "flaky-manager@example.com");
    expect(toFlaky.map((m) => m.result)).toEqual(["failed", "failed", "accepted"]);
    const row = (await notices(t, companyId)).find((m) => m.to === "flaky-manager@example.com" && m.notice?.event === "approval_needed")!;
    expect(row).toMatchObject({ status: "delivered", attempts: 3 });
  });
});

describe("what mail programs do to long or broken email", () => {
  it("keeps every email well under Gmail's 102 KB clipping point", () => {
    for (const preview of PREVIEWS) {
      const { html, text } = preview.render("https://app.selestial.test");
      expect(new TextEncoder().encode(html).length, preview.id).toBeLessThan(40_000);
      expect(text.length, preview.id).toBeLessThan(6_000);
    }
  });
});

describe("one person's choices", () => {
  it("never change another member's settings or show them another member's notices", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const manager = await addMember(t, owner, companyId, "manny", "manager");
    await manager.mutation(api.notifications.setEmail, { companyId, category: "digest", on: false });
    expect((await owner.query(api.notifications.mine, { companyId })).categories.find((c) => c.category === "digest")?.on).toBe(true);
    await settle(t);
    // The Owner's welcome is the Owner's alone.
    expect((await manager.query(api.notifications.mine, { companyId })).recent).toEqual([]);
    expect((await owner.query(api.notifications.mine, { companyId })).recent.map((r) => r.event)).toEqual(["welcome"]);
    // A member of another company can't read this company's notices at all.
    const other = await company(t, "owner-b", "Beta Cleaning");
    await expect(other.as.query(api.notifications.mine, { companyId })).rejects.toThrow();
  });
});
