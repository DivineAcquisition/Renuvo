/**
 * @vitest-environment edge-runtime
 *
 * Notifications to the people who run a company (convex/lib/notify): who gets one, when, what it says at
 * the moment it goes, and what happens after (delivery, bounce, spam report, unsubscribe).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addressOf, companySender, isVerifiedFrom, platformSender } from "./lib/email/senders";
import { cleanHeaders, emailProvider as sharedProvider } from "./lib/email/provider";
import { mockEmails } from "./lib/messaging/email";
import { noticeToken } from "./lib/notify/unsubscribe";

const SECRET = "test-only-secret-for-action-links-0123456789";
// Wednesday Nov 18 2026, 11:00 AM in Chicago: daytime, so nothing waits for the morning.
const DAYTIME = Date.UTC(2026, 10, 18, 17, 0);
// 2:00 AM in Chicago.
const NIGHT = Date.UTC(2026, 10, 19, 8, 0);
const HOUR = 3_600_000;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DAYTIME);
  process.env.ACTION_LINK_SECRET = SECRET;
  process.env.EMAIL_PROVIDER = "mock";
  process.env.APP_ORIGIN = "https://app.selestial.test";
  process.env.CONVEX_SITE_URL = "https://deployment.convex.site";
  mockEmails.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  for (const name of ["ACTION_LINK_SECRET", "EMAIL_PROVIDER", "APP_ORIGIN", "CONVEX_SITE_URL", "EMAIL_FROM", "NOTIFY_EMAIL_FROM", "COMPANY_EMAIL_FROM", "RECRUITER_EMAIL_FROM"]) delete process.env[name];
});

async function setup() {
  const t = start();
  const { as: owner, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const manager = await addMember(t, owner, companyId, "manny", "manager");
  const office = await addMember(t, owner, companyId, "olive", "office");
  const ids = await t.run(async (ctx) => {
    const members = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    const by = (email: string) => members.find((m) => m.email === email)!._id;
    return { owner: by("owner-a@example.com"), manager: by("manny@example.com"), office: by("olive@example.com") };
  });
  // Whatever creating the company planned is settled first, so each test starts from a quiet outbox.
  await settle(t);
  mockEmails.length = 0;
  return { t, owner, manager, office, companyId, ids };
}

async function approval(t: T, companyId: Id<"companies">, decideBy = DAYTIME + 6 * HOUR) {
  return t.run((ctx) =>
    ctx.db.insert("approvals", { companyId, agent: "sales", action: "send_quote", summary: "Send a revised quote to the Hendersons", reason: "They asked for biweekly service.", authorizes: "Send one email with the revised quote.", ifWaiting: "The quote isn't sent.", status: "pending", decideBy, createdAt: Date.now() }),
  );
}

const notices = (t: T, companyId: Id<"companies">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("messages")
        .withIndex("by_company_queued", (q) => q.eq("companyId", companyId))
        .collect()
    ).filter((m) => m.purpose === "member_notice"),
  );

describe("who gets a notice", () => {
  it("reaches the roles the event is for, once each, and never another company's members", async () => {
    const s = await setup();
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    const approvalId = await approval(s.t, s.companyId);
    const first = await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId });
    expect(first).toEqual({ planned: 2, skipped: 0 });
    // The same event reported again plans nothing new.
    expect(await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId })).toEqual({ planned: 0, skipped: 2 });
    await settle(s.t);
    const sent = mockEmails.map((m) => m.to).sort();
    expect(sent).toEqual(["manny@example.com", "owner-a@example.com"]);
    expect(sent).not.toContain("owner-b@example.com");
    const rows = await notices(s.t, other.companyId);
    expect(rows).toHaveLength(0);
  });

  it("follows each person's settings, except security, and account for the Owner", async () => {
    const s = await setup();
    await s.manager.mutation(api.notifications.setEmail, { companyId: s.companyId, category: "approvals", on: false });
    expect(await refusal(s.owner.mutation(api.notifications.setEmail, { companyId: s.companyId, category: "security", on: false }))).toContain("Security notices are always sent");
    expect(await refusal(s.owner.mutation(api.notifications.setEmail, { companyId: s.companyId, category: "account", on: false }))).toContain("The Owner always gets account notices");
    // A Manager may turn account notices off; only the Owner can't.
    await s.manager.mutation(api.notifications.setEmail, { companyId: s.companyId, category: "account", on: false });

    const approvalId = await approval(s.t, s.companyId);
    expect(await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId })).toEqual({ planned: 1, skipped: 1 });
    const mine = await s.manager.query(api.notifications.mine, { companyId: s.companyId });
    expect(mine.categories.find((c) => c.category === "approvals")).toMatchObject({ on: false, locked: false });
    expect(mine.categories.find((c) => c.category === "security")).toMatchObject({ on: true, locked: true });
    const ownerView = await s.owner.query(api.notifications.mine, { companyId: s.companyId });
    expect(ownerView.categories.find((c) => c.category === "account")).toMatchObject({ on: true, locked: true });
  });

  it("names a person directly, still only inside the company", async () => {
    const s = await setup();
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    const outsider = await s.t.run(async (ctx) => (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", other.companyId)).first())!._id);
    const result = await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "security_change", key: "role-1", facts: { kind: "role_changed", memberName: "Olive", from: "Office", to: "Manager", byName: "Owner A" }, only: [s.ids.office, outsider] });
    expect(result.planned).toBe(1);
    await settle(s.t);
    expect(mockEmails.map((m) => m.to)).toEqual(["olive@example.com"]);
  });
});

describe("what a notice says, written when it goes", () => {
  it("is from Selestial, in the designed frame, with the plain words kept on the record and an unsubscribe header", async () => {
    const s = await setup();
    const approvalId = await approval(s.t, s.companyId);
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId, only: [s.ids.owner] });
    await settle(s.t);
    expect(mockEmails).toHaveLength(1);
    const mail = mockEmails[0];
    expect(mail.from).toBe('"Selestial" <messages@mail.selestial.test>');
    expect(mail.subject).toBe("Sales needs your decision: Send a revised quote to the Hendersons");
    expect(mail.html).toContain("Review and decide");
    expect(mail.html).toContain(`https://app.selestial.test/app/approvals?open=${approvalId}`);
    expect(mail.text).toContain("Opening this doesn't approve anything.");
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/deployment\.convex\.site\/notify\/unsubscribe\?t=/);
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const [row] = await notices(s.t, s.companyId);
    expect(row).toMatchObject({ status: "delivered", subject: mail.subject, memberId: s.ids.owner });
    expect(row.body).toContain("Send a revised quote to the Hendersons");
  });

  it("doesn't go when what it's about changed first: the proposal was decided", async () => {
    const s = await setup();
    const approvalId = await approval(s.t, s.companyId);
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId, only: [s.ids.owner] });
    await s.t.run((ctx) => ctx.db.patch(approvalId, { status: "approved" }));
    await settle(s.t);
    expect(mockEmails).toHaveLength(0);
    const [row] = await notices(s.t, s.companyId);
    expect(row).toMatchObject({ status: "not_sent", problem: "The proposal was decided before this notice went." });
  });

  it("never carries an unsubscribe link or header on a security notice", async () => {
    const s = await setup();
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "security_change", key: "removed-1", facts: { kind: "member_removed", memberName: "Sam", byName: "Owner A" } });
    await settle(s.t);
    expect(mockEmails).toHaveLength(1);
    expect(mockEmails[0].headers ?? {}).toEqual({});
    expect(mockEmails[0].text).not.toMatch(/unsubscribe/i);
    expect(mockEmails[0].text).toContain("Security and account notices are always sent.");
  });

  it("waits for the morning at night, except a critical one", async () => {
    const s = await setup();
    vi.setSystemTime(NIGHT);
    const approvalId = await approval(s.t, s.companyId, NIGHT + 12 * HOUR);
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId, only: [s.ids.owner] });
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "security_change", key: "x", facts: { kind: "member_removed", memberName: "Sam", byName: "Owner A" } });
    const rows = await notices(s.t, s.companyId);
    expect(rows.find((r) => r.notice?.event === "approval_needed")).toMatchObject({ status: "held" });
    expect(rows.find((r) => r.notice?.event === "security_change")).toMatchObject({ status: "queued" });
    await settle(s.t);
    // Both went in the end: the approval at 7:00 AM company time.
    expect(mockEmails.map((m) => m.subject).sort()).toEqual(["Sales needs your decision: Send a revised quote to the Hendersons", "Security notice: Sam no longer has access"]);
  });
});

describe("after it goes", () => {
  async function sentNotice() {
    const s = await setup();
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "security_change", key: "a", facts: { kind: "member_removed", memberName: "Sam", byName: "Owner A" } });
    await settle(s.t);
    const [row] = await notices(s.t, s.companyId);
    // The mock reports delivery at once; a real provider says "sent" and reports later.
    await s.t.run((ctx) => ctx.db.patch(row._id, { status: "sent", deliveredAt: undefined }));
    return { ...s, row };
  }

  it("keeps bounce, complaint, provider suppression and delivery apart", async () => {
    const s = await sentNotice();
    const receipt = (eventId: string, outcome: "delivered" | "bounced" | "complained" | "suppressed" | "delayed") => s.t.mutation(internal.messaging.receipt, { provider: "mock-email", eventId, providerMessageId: s.row.providerMessageId!, outcome });
    expect(await receipt("e1", "delayed")).toBe("delayed");
    expect(await receipt("e2", "delivered")).toBe("delivered");
    // A spam report after delivery still counts, and the delivery stands.
    expect(await receipt("e3", "complained")).toBe("complained");
    expect(await receipt("e3", "complained")).toBe("duplicate");
    const row = await s.t.run((ctx) => ctx.db.get(s.row._id));
    expect(row).toMatchObject({ status: "delivered" });
    expect(row?.complainedAt).toBeTypeOf("number");
    expect(row?.bouncedAt).toBeUndefined();
    const blocked = await s.owner.query(api.notifications.mine, { companyId: s.companyId });
    expect(blocked.blocked?.reason).toBe("complaint");
  });

  it("stops notices to an address that bounced, says so, and lets the person clear it", async () => {
    const s = await sentNotice();
    expect(await s.t.mutation(internal.messaging.receipt, { provider: "mock-email", eventId: "b1", providerMessageId: s.row.providerMessageId!, outcome: "bounced" })).toBe("bounced");
    expect(await s.t.run((ctx) => ctx.db.get(s.row._id))).toMatchObject({ status: "failed" });
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "security_change", key: "b", facts: { kind: "member_removed", memberName: "Kim", byName: "Owner A" }, only: [s.ids.owner] });
    const next = (await notices(s.t, s.companyId)).find((r) => r.dedupeKey.includes(":b:"));
    expect(next).toMatchObject({ status: "not_sent", problem: "Email to this address bounced, so Selestial stopped sending notices to it." });
    // Another member's address isn't affected.
    expect((await s.manager.query(api.notifications.mine, { companyId: s.companyId })).blocked).toBeNull();
    expect(await s.owner.mutation(api.notifications.clearBlock, { companyId: s.companyId })).toEqual({ cleared: true });
    expect((await s.owner.query(api.notifications.mine, { companyId: s.companyId })).blocked).toBeNull();
  });
});

describe("unsubscribing", () => {
  it("turns off only that notice's category, for only that person, and only on purpose", async () => {
    const s = await setup();
    const approvalId = await approval(s.t, s.companyId);
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "approval_needed", ref: approvalId, only: [s.ids.manager] });
    const [row] = await notices(s.t, s.companyId);
    const token = (await noticeToken(row._id))!;
    // Opening the page reads; it changes nothing.
    expect(await s.t.query(api.notifications.unsubscribeInfo, { token })).toEqual({ company: "Alpha Cleaning", label: "Approvals", about: expect.any(String), off: false, locked: false });
    expect(await s.t.query(api.notifications.unsubscribeInfo, { token: `${token}x` })).toBeNull();
    expect(await s.t.query(api.notifications.unsubscribeInfo, { token: `${row._id}.forged` })).toBeNull();
    // The mail program's own button.
    expect(await s.t.mutation(internal.notifications.oneClick, { token })).toEqual({ ok: true });
    const manager = await s.manager.query(api.notifications.mine, { companyId: s.companyId });
    expect(manager.categories.find((c) => c.category === "approvals")?.on).toBe(false);
    const owner = await s.owner.query(api.notifications.mine, { companyId: s.companyId });
    expect(owner.categories.find((c) => c.category === "approvals")?.on).toBe(true);
  });

  it("can't turn off security notices, whatever the link", async () => {
    const s = await setup();
    await s.t.mutation(internal.notifications.notify, { companyId: s.companyId, event: "security_change", key: "s", facts: { kind: "member_removed", memberName: "Sam", byName: "Owner A" }, only: [s.ids.manager] });
    const [row] = await notices(s.t, s.companyId);
    const token = (await noticeToken(row._id))!;
    expect((await s.t.query(api.notifications.unsubscribeInfo, { token }))?.locked).toBe(true);
    expect(await s.t.mutation(internal.notifications.oneClick, { token })).toEqual({ ok: false, why: "Security and account notices can't be turned off." });
  });
});

describe("who an email may be from", () => {
  it("builds every From from the deployment's own senders, and refuses anything else", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_FROM = "Selestial <team@mail.selestial.io>";
    process.env.NOTIFY_EMAIL_FROM = "Selestial <notify@notify.selestial.io>";
    expect(platformSender()).toEqual({ ok: true, from: '"Selestial" <notify@notify.selestial.io>' });
    expect(companySender('Alpha "Cleaning" <admin@evil.example>\r\nBcc: x')).toEqual({ ok: true, from: '"Alpha Cleaning admin@evil.example Bcc: x via Selestial" <team@mail.selestial.io>' });
    expect(companySender("   ")).toMatchObject({ ok: false });
    expect(isVerifiedFrom('"Alpha" <team@mail.selestial.io>')).toBe(true);
    expect(isVerifiedFrom('"Alpha" <owner@alpha.example>')).toBe(false);
    expect(isVerifiedFrom("team@mail.selestial.io.evil.example")).toBe(false);
    expect(addressOf("Not an address")).toBeNull();
    // With no sender configured, real mail waits: no fallback identity.
    delete process.env.EMAIL_FROM;
    delete process.env.NOTIFY_EMAIL_FROM;
    expect(platformSender()).toMatchObject({ ok: false });
    expect(companySender("Alpha")).toMatchObject({ ok: false });
  });

  it("has the provider refuse an unverified From or a header that could add a line, without calling Resend", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "test-key-not-real";
    process.env.EMAIL_FROM = "Selestial <team@mail.selestial.io>";
    const fetched = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetched);
    try {
      const provider = sharedProvider()!;
      const base = { to: "a@example.com", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "k" };
      expect(await provider.send({ ...base, from: '"Alpha" <owner@alpha.example>' })).toMatchObject({ ok: false, retryable: false });
      expect(await provider.send({ ...base, headers: { Bcc: "x@example.com" } })).toMatchObject({ ok: false });
      expect(await provider.send({ ...base, headers: { "List-Unsubscribe": "<https://x>\r\nBcc: y" } })).toMatchObject({ ok: false });
      expect(fetched).not.toHaveBeenCalled();
      expect(await provider.send({ ...base, from: '"Alpha via Selestial" <team@mail.selestial.io>', headers: { "List-Unsubscribe": "<https://x>" } })).toEqual({ ok: true, providerMessageId: "re_1" });
      const body = JSON.parse(String((fetched.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body).toMatchObject({ from: '"Alpha via Selestial" <team@mail.selestial.io>', headers: { "List-Unsubscribe": "<https://x>" } });
      expect(cleanHeaders({ "X-Entity-Ref-ID": "abc" })).toEqual({ "X-Entity-Ref-ID": "abc" });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.RESEND_API_KEY;
    }
  });
});

describe("a sign-in code", () => {
  it("is never held or retried without its code", async () => {
    const s = await setup();
    const messageId = await s.t.run((ctx) =>
      ctx.db.insert("messages", { companyId: s.companyId, purpose: "verification_code", channel: "email", to: "cleaner@example.com", body: "Your code is {code}", dedupeKey: "code-1", status: "queued", attempts: 0, queuedAt: Date.now() }),
    );
    // Scheduled again without the code (as a retry would be): it isn't sent with a blank.
    await s.t.action(internal.messaging.deliver, { messageId });
    const row = await s.t.run((ctx) => ctx.db.get(messageId));
    expect(row?.status).toBe("not_sent");
    expect(mockEmails.some((m) => m.text.includes("{code}"))).toBe(false);
  });
});
