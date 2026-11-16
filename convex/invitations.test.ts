/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, person, refusal, start, TEST_LINK_SECRET, type T } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACCEPTS_PER_USER, INVITES_PER_COMPANY_PER_HOUR } from "./invitations";
import { mockEmailOutbox } from "./lib/email/provider";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { INVITATION_DAYS } from "./lib/invitations";

const DAY = 24 * 60 * 60 * 1000;
const LIFETIME = INVITATION_DAYS * DAY;
const ORIGIN = "https://app.selestial.test";

/** Runs what was scheduled for now (the email send and its settling) without moving far in time. */
async function flush(t: T) {
  for (let i = 0; i < 6; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

async function code(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return (error as { data?: { code?: unknown } }).data?.code;
  }
  throw new Error("expected a refusal");
}

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const invite = async (subject: string, role: "manager" | "office" = "office", address = `${subject}@example.com`) => {
    const made = await as.mutation(api.invitations.create, { companyId, email: address, name: subject, role });
    const { token } = await as.mutation(api.invitations.link, { companyId, invitationId: made.invitationId });
    return { ...made, token: token! };
  };
  const listed = () => as.query(api.invitations.list, { companyId });
  const members = () => as.query(api.members.list, { companyId });
  const events = async (type: string) => (await as.query(api.events.recent, { companyId, limit: 200 })).filter((event) => event.type === type);
  return { t, as, companyId, invite, listed, members, events };
}

/** Everything at rest, as text: every row of every table that could hold a token, and what is scheduled. */
async function everythingStored(t: T): Promise<string> {
  return t.run(async (ctx) =>
    JSON.stringify([
      await ctx.db.query("invitations").collect(),
      await ctx.db.query("members").collect(),
      await ctx.db.query("companies").collect(),
      await ctx.db.query("events").collect(),
      await ctx.db.query("rateLimits").collect(),
      await ctx.db.system.query("_scheduled_functions").collect(),
    ]),
  );
}

/** The link in the newest email to this address, as the person would receive it. */
function emailed(address: string): { token: string; url: string; html: string; text: string; subject: string } {
  const mail = mockEmailOutbox.filter((row) => row.to === address && row.result === "accepted").at(-1);
  if (!mail) throw new Error(`no invitation was emailed to ${address}`);
  const match = mail.text.match(/(https?:\/\/\S+\/invite\/([A-Za-z0-9_.-]+))/);
  if (!match) throw new Error("the email has no invitation link");
  return { token: match[2], url: match[1], html: mail.html, text: mail.text, subject: mail.subject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.ACTION_LINK_SECRET = TEST_LINK_SECRET;
  mockEmailOutbox.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of ["ACTION_LINK_SECRET", "EMAIL_PROVIDER", "APP_ORIGIN", "SITE_ORIGIN", "RESEND_API_KEY", "EMAIL_FROM"]) delete process.env[name];
});

describe("inviting a person", () => {
  it("makes an invitation whose link shows the company, the role and a masked address", async () => {
    const s = await setup();
    const made = await s.invite("mia", "manager", " Mia@Example.com ");
    // With no email service connected, the Owner is told so and can still copy the link.
    expect(made.delivery).toBe("not_configured");

    expect(await s.t.query(api.invitations.preview, { token: made.token })).toEqual({
      state: "pending",
      companyName: "Alpha Cleaning",
      role: "manager",
      emailHint: "m•••@example.com",
      expiresAt: NOW + LIFETIME,
    });
    expect(await s.listed()).toEqual([
      {
        id: made.invitationId,
        email: "mia@example.com",
        name: "mia",
        role: "manager",
        state: "pending",
        createdAt: NOW,
        expiresAt: NOW + LIFETIME,
        delivery: { state: "not_sent", at: NOW, problem: "Email sending isn't set up yet, so the email wasn't sent." },
      },
    ]);
    expect((await s.members()).find((row) => row.email === "mia@example.com")).toMatchObject({ role: "manager", status: "invited" });
    expect(await s.events("member.invited")).toHaveLength(1);
  });

  it("refuses a second invitation for the same address, and an address already in the company", async () => {
    const s = await setup();
    await s.invite("mia");
    expect(await refusal(s.as.mutation(api.invitations.create, { companyId: s.companyId, email: "MIA@example.com", name: "Mia again", role: "manager" }))).toContain("already been invited");
    expect(await refusal(s.as.mutation(api.invitations.create, { companyId: s.companyId, email: "owner-a@example.com", name: "Me", role: "manager" }))).toContain("already in this company");
    expect(await refusal(s.as.mutation(api.invitations.create, { companyId: s.companyId, email: "not an address", name: "X", role: "office" }))).toContain("not a valid email");
    expect(await s.listed()).toHaveLength(1);
    expect(await s.members()).toHaveLength(2);
  });

  it("uses the same rows again when the earlier invitation ran out or was revoked", async () => {
    const s = await setup();
    const first = await s.invite("mia");
    vi.setSystemTime(NOW + LIFETIME + 1);
    const second = await s.invite("mia", "manager");
    expect(second.invitationId).toBe(first.invitationId);
    expect(await s.t.query(api.invitations.preview, { token: first.token })).toEqual({ state: "not_found" });
    expect(await s.t.query(api.invitations.preview, { token: second.token })).toMatchObject({ state: "pending", role: "manager" });

    await s.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: second.invitationId });
    vi.setSystemTime(NOW + LIFETIME + DAY);
    const third = await s.invite("mia", "office");
    expect(third.invitationId).toBe(first.invitationId);
    expect(await s.listed()).toMatchObject([{ state: "pending", role: "office", createdAt: NOW + LIFETIME + DAY, expiresAt: NOW + 2 * LIFETIME + DAY }]);
    // One row for Mia beside the Owner's, however many times she was invited.
    expect(await s.t.run((ctx) => ctx.db.query("members").collect())).toHaveLength(2);
  });

  it("makes nothing when the deployment has no link secret", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    delete process.env.ACTION_LINK_SECRET;
    expect(await refusal(s.as.mutation(api.invitations.create, { companyId: s.companyId, email: "noor@example.com", name: "Noor", role: "office" }))).toBe("Invitation links need setup by Selestial's team before they can be used.");
    expect(await s.listed()).toHaveLength(1);
    expect(await s.members()).toHaveLength(2);
    // A link made earlier opens nothing either, for a visitor or for someone signed in.
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toEqual({ state: "not_found" });
    expect(await s.t.withIdentity(person("mia")).mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "not_found" });
    expect(await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId })).toEqual({ token: null });
    // A secret too short to be one is treated as none.
    process.env.ACTION_LINK_SECRET = "short";
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toEqual({ state: "not_found" });
  });

  it("stops a company that sends too many in an hour, and opens again later", async () => {
    const s = await setup();
    for (let i = 0; i < INVITES_PER_COMPANY_PER_HOUR; i += 1) {
      await s.as.mutation(api.invitations.create, { companyId: s.companyId, email: `person${i}@example.com`, name: `Person ${i}`, role: "office" });
    }
    const oneMore = () => s.as.mutation(api.invitations.create, { companyId: s.companyId, email: "one-too-many@example.com", name: "One more", role: "office" });
    expect(await code(oneMore())).toBe("limit");
    const first = (await s.listed()).at(-1)!;
    expect(await code(s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: first.id }))).toBe("limit");
    expect(await s.listed()).toHaveLength(INVITES_PER_COMPANY_PER_HOUR);
    // Another company is not held back.
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    await other.as.mutation(api.invitations.create, { companyId: other.companyId, email: "x@example.com", name: "X", role: "office" });

    vi.setSystemTime(NOW + 61 * 60 * 1000);
    expect((await oneMore()).delivery).toBe("not_configured");
  });
});

describe("accepting an invitation", () => {
  it("lets the invited, verified person in with the invitation's role, once", async () => {
    const s = await setup();
    const made = await s.invite("mia", "office");
    const mia = s.t.withIdentity(person("mia"));
    expect(await refusal(mia.query(api.companies.get, { companyId: s.companyId }))).toBe(NOT_FOUND);

    vi.setSystemTime(NOW + 1000);
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "joined", companyId: s.companyId });
    expect((await mia.query(api.companies.get, { companyId: s.companyId })).role).toBe("office");
    expect(await mia.query(api.companies.mine, {})).toEqual([{ companyId: s.companyId, name: "Alpha Cleaning", role: "office" }]);
    expect(await s.listed()).toMatchObject([{ state: "accepted", acceptedAt: NOW + 1000 }]);
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toMatchObject({ state: "accepted", companyName: "Alpha Cleaning" });

    // The same person opening the link again is still in, and nothing is made or recorded twice.
    const before = await everythingStored(s.t);
    vi.setSystemTime(NOW + 2000);
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "joined", companyId: s.companyId });
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "joined", companyId: s.companyId });
    const stored = await s.t.run(async (ctx) => ({ members: await ctx.db.query("members").collect(), invitations: await ctx.db.query("invitations").collect() }));
    expect(stored.members).toHaveLength(2);
    expect(stored.members.filter((row) => row.userId === "mia")).toMatchObject([{ status: "active", role: "office", email: "mia@example.com" }]);
    expect(stored.invitations).toMatchObject([{ status: "accepted", acceptedUserId: "mia", acceptedAt: NOW + 1000 }]);
    expect(await s.events("member.joined")).toHaveLength(1);
    expect(await s.events("member.invited")).toHaveLength(1);
    // Only the count of tries moved.
    expect((await everythingStored(s.t)).replace(/"count":\d+/g, "")).toBe(before.replace(/"count":\d+/g, ""));
  });

  it("takes the role from the invitation and nothing from the person accepting", async () => {
    const s = await setup();
    const made = await s.invite("mia", "office");
    const mia = s.t.withIdentity(person("mia"));
    // There is no role, email or company to pass: anything extra is refused outright.
    for (const extra of [{ role: "owner" }, { role: "manager" }, { email: "owner-a@example.com" }, { companyId: s.companyId }]) {
      await expect(mia.mutation(api.invitations.accept, { token: made.token, ...extra } as never)).rejects.toThrow();
    }
    expect(await refusal(mia.query(api.companies.get, { companyId: s.companyId }))).toBe(NOT_FOUND);
    await mia.mutation(api.invitations.accept, { token: made.token });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("members").collect()).find((row) => row.userId === "mia")!.role)).toBe("office");
    expect(await refusal(mia.mutation(api.companies.update, { companyId: s.companyId, name: "Mine now" }))).toBe(NOT_ALLOWED);
  });

  it("gives the role the Owner last set, when it was changed before the person joined", async () => {
    const s = await setup();
    const made = await s.invite("mia", "office");
    const memberId = (await s.members()).find((row) => row.status === "invited")!.id;
    await s.as.mutation(api.members.setRole, { companyId: s.companyId, memberId, role: "manager" });
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toMatchObject({ role: "manager" });
    const mia = s.t.withIdentity(person("mia"));
    await mia.mutation(api.invitations.accept, { token: made.token });
    expect((await mia.query(api.companies.get, { companyId: s.companyId })).role).toBe("manager");
  });

  it("turns away another account and an unverified email, and makes no membership", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const stranger = s.t.withIdentity(person("stranger"));
    expect(await stranger.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "wrong_account", emailHint: "m•••@example.com" });
    const unverified = s.t.withIdentity(person("mia", { emailVerified: false }));
    expect(await unverified.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "unverified" });
    // An unverified account at another address is told to verify, not which address was invited.
    expect(await s.t.withIdentity(person("stranger", { emailVerified: false })).mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "unverified" });
    // Signed out, there is nobody to let in.
    expect(await refusal(s.t.mutation(api.invitations.accept, { token: made.token }))).toBe(NOT_FOUND);

    for (const who of [stranger, unverified]) expect(await refusal(who.query(api.companies.get, { companyId: s.companyId }))).toBe(NOT_FOUND);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("members").collect()).filter((row) => row.status === "active"))).toHaveLength(1);
    expect(await s.listed()).toMatchObject([{ state: "pending" }]);
    expect(await s.events("member.joined")).toHaveLength(0);
  });

  it("stops working at its expiry, by link and by email alike", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const mia = s.t.withIdentity(person("mia"));

    vi.setSystemTime(NOW + LIFETIME - 1);
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toMatchObject({ state: "pending" });
    expect(await mia.query(api.members.invitations, {})).toEqual([{ companyId: s.companyId, companyName: "Alpha Cleaning", role: "office" }]);

    vi.setSystemTime(NOW + LIFETIME);
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toEqual({ state: "expired", companyName: "Alpha Cleaning", role: "office", emailHint: "m•••@example.com", expiresAt: NOW + LIFETIME });
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "expired" });
    expect(await mia.query(api.members.invitations, {})).toEqual([]);
    expect(await refusal(mia.mutation(api.members.join, { companyId: s.companyId }))).toBe(NOT_FOUND);
    expect(await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId })).toEqual({ token: null });
    expect(await s.listed()).toMatchObject([{ state: "expired" }]);
    expect(await refusal(mia.query(api.companies.get, { companyId: s.companyId }))).toBe(NOT_FOUND);
    // Expired is read from the clock. Nothing was stored to say so.
    expect(await s.t.run(async (ctx) => (await ctx.db.query("invitations").collect())[0].status)).toBe("pending");
  });

  it("is closed by revoking, which also takes the invited row away", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const mia = s.t.withIdentity(person("mia"));
    expect(await s.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId })).toBeNull();

    expect(await s.t.query(api.invitations.preview, { token: made.token })).toMatchObject({ state: "revoked", companyName: "Alpha Cleaning" });
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "revoked" });
    expect(await mia.query(api.members.invitations, {})).toEqual([]);
    expect(await refusal(mia.mutation(api.members.join, { companyId: s.companyId }))).toBe(NOT_FOUND);
    expect(await s.members()).toHaveLength(1);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("members").collect()).find((row) => row.email === "mia@example.com")!.status)).toBe("removed");
    expect(await s.listed()).toMatchObject([{ state: "revoked" }]);
    expect(await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId })).toEqual({ token: null });

    // Revoking again changes nothing and records nothing.
    expect(await s.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId })).toBeNull();
    expect(await s.events("invitation.revoked")).toHaveLength(1);
  });

  it("is closed when the Owner removes the invited person from the member list", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const memberId = (await s.members()).find((row) => row.status === "invited")!.id;
    await s.as.mutation(api.members.remove, { companyId: s.companyId, memberId });
    expect(await s.listed()).toMatchObject([{ state: "revoked" }]);
    expect(await s.t.withIdentity(person("mia")).mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "revoked" });
    expect(await s.events("invitation.revoked")).toHaveLength(1);
  });

  it("cannot be revoked or sent again once accepted", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    await s.t.withIdentity(person("mia")).mutation(api.invitations.accept, { token: made.token });
    expect(await refusal(s.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId }))).toContain("already accepted");
    expect(await refusal(s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId }))).toContain("already accepted");
    expect(await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId })).toEqual({ token: null });
    expect(await s.listed()).toMatchObject([{ state: "accepted" }]);
    expect((await s.members()).filter((row) => row.status === "active")).toHaveLength(2);
  });

  it("gets a new link when sent again, and the old link stops", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    vi.setSystemTime(NOW + 3 * DAY);
    expect(await s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId })).toEqual({ delivery: "not_configured" });
    const { token } = await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId });
    expect(token).not.toBe(made.token);

    const mia = s.t.withIdentity(person("mia"));
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toEqual({ state: "not_found" });
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "not_found" });
    expect(await s.t.query(api.invitations.preview, { token: token! })).toMatchObject({ state: "pending", expiresAt: NOW + 3 * DAY + LIFETIME });
    expect(await s.events("invitation.reissued")).toHaveLength(1);
    expect(await mia.mutation(api.invitations.accept, { token: token! })).toEqual({ status: "joined", companyId: s.companyId });
  });

  it("can be sent again after it expired or was revoked", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    vi.setSystemTime(NOW + LIFETIME + DAY);
    await s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId });
    expect(await s.listed()).toMatchObject([{ state: "pending", expiresAt: NOW + 2 * LIFETIME + DAY }]);

    await s.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId });
    expect(await s.members()).toHaveLength(1);
    await s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId });
    // The invited row is back with the invitation.
    expect((await s.members()).find((row) => row.email === "mia@example.com")).toMatchObject({ status: "invited" });
    const { token } = await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId });
    expect(await s.t.withIdentity(person("mia")).mutation(api.invitations.accept, { token: token! })).toEqual({ status: "joined", companyId: s.companyId });
  });

  it("tells a second person that the link has been used", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    await s.t.withIdentity(person("mia")).mutation(api.invitations.accept, { token: made.token });
    // Someone else holding the link, and someone else who now has that address, are both told it is used.
    expect(await s.t.withIdentity(person("stranger")).mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "used" });
    expect(await s.t.withIdentity(person("mia-2", { email: "mia@example.com" })).mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "used" });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("members").collect()).filter((row) => row.status === "active"))).toHaveLength(2);
    expect(await s.events("member.joined")).toHaveLength(1);
  });

  it("keeps one membership when someone already in the company is invited at another address", async () => {
    const s = await setup();
    await addMember(s.t, s.as, s.companyId, "mia", "manager");
    const made = await s.invite("mia-work", "office");
    // The same sign-in, whose verified address is now the invited one.
    const mia = s.t.withIdentity(person("mia", { email: "mia-work@example.com" }));
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "already_member", companyId: s.companyId });

    const rows = await s.t.run((ctx) => ctx.db.query("members").collect());
    expect(rows.filter((row) => row.userId === "mia")).toMatchObject([{ status: "active", role: "manager", email: "mia@example.com" }]);
    expect(rows.filter((row) => row.status !== "removed")).toHaveLength(2);
    expect((await mia.query(api.companies.get, { companyId: s.companyId })).role).toBe("manager");
    expect((await s.listed()).find((row) => row.id === made.invitationId)).toMatchObject({ state: "accepted" });
    // She joined once, the first time.
    expect(await s.events("member.joined")).toHaveLength(1);
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "joined", companyId: s.companyId });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("members").collect()).filter((row) => row.status === "active"))).toHaveLength(2);
  });

  it("lets a person who was removed come back on a new invitation", async () => {
    const s = await setup();
    const first = await s.invite("mia", "office");
    const mia = s.t.withIdentity(person("mia"));
    await mia.mutation(api.invitations.accept, { token: first.token });
    const memberId = (await s.members()).find((row) => row.email === "mia@example.com")!.id;
    await s.as.mutation(api.members.remove, { companyId: s.companyId, memberId });
    expect(await refusal(mia.query(api.companies.get, { companyId: s.companyId }))).toBe(NOT_FOUND);
    // Her old link does not say she is in, because she is not. It is spent.
    expect(await mia.mutation(api.invitations.accept, { token: first.token })).toEqual({ status: "used" });
    expect(await refusal(mia.mutation(api.members.join, { companyId: s.companyId }))).toBe(NOT_FOUND);

    const again = await s.invite("mia", "manager");
    expect(again.invitationId).not.toBe(first.invitationId);
    expect(await mia.mutation(api.invitations.accept, { token: again.token })).toEqual({ status: "joined", companyId: s.companyId });
    expect((await mia.query(api.companies.get, { companyId: s.companyId })).role).toBe("manager");
    expect(await s.t.run(async (ctx) => (await ctx.db.query("members").collect()).filter((row) => row.userId === "mia"))).toHaveLength(1);
  });

  it("joins by verified email without the link, marking the same invitation accepted", async () => {
    const s = await setup();
    const made = await s.invite("mia", "manager");
    const mia = s.t.withIdentity(person("mia"));
    vi.setSystemTime(NOW + 1000);
    const memberId = await mia.mutation(api.members.join, { companyId: s.companyId });
    expect((await s.members()).find((row) => row.id === memberId)).toMatchObject({ role: "manager", status: "active" });
    expect(await s.t.run(async (ctx) => (await ctx.db.get(made.invitationId))!)).toMatchObject({ status: "accepted", acceptedUserId: "mia", acceptedAt: NOW + 1000 });
    expect(await mia.query(api.members.invitations, {})).toEqual([]);
    expect(await s.events("member.joined")).toHaveLength(1);
    // The link now says what happened, to her and to anyone else.
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "joined", companyId: s.companyId });
    expect(await s.t.withIdentity(person("stranger")).mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "used" });
    expect(await s.events("member.joined")).toHaveLength(1);
  });

  it("limits how often one person can try, without stopping anyone else", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const stranger = s.t.withIdentity(person("stranger"));
    for (let i = 0; i < ACCEPTS_PER_USER; i += 1) {
      expect(await stranger.mutation(api.invitations.accept, { token: `${"x".repeat(22)}.${"y".repeat(43)}` })).toEqual({ status: "not_found" });
    }
    expect(await stranger.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "limited" });
    const mia = s.t.withIdentity(person("mia"));
    expect(await mia.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "joined", companyId: s.companyId });

    vi.setSystemTime(NOW + 11 * 60 * 1000);
    expect(await stranger.mutation(api.invitations.accept, { token: made.token })).toEqual({ status: "used" });
  });
});

describe("invitation links", () => {
  it("open nothing when malformed or tampered with", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const [publicId, signature] = made.token.split(".");
    const flipped = (value: string) => `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;
    const bad = [
      "",
      ".",
      "not-a-token",
      publicId,
      `${publicId}.`,
      `.${signature}`,
      `${publicId}.${flipped(signature)}`,
      `${flipped(publicId)}.${signature}`,
      `${publicId}.${signature}.extra`,
      `${made.token} `,
      `${publicId}.${signature}=`,
      "x".repeat(5000),
      made.invitationId,
    ];
    const mia = s.t.withIdentity(person("mia"));
    for (const token of bad) {
      expect(await s.t.query(api.invitations.preview, { token }), token).toEqual({ state: "not_found" });
      expect(await mia.mutation(api.invitations.accept, { token }), token).toEqual({ status: "not_found" });
    }
    expect(await refusal(mia.query(api.companies.get, { companyId: s.companyId }))).toBe(NOT_FOUND);
  });

  it("are not opened by a token signed the way a cleaner's link is, or with another secret", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const publicId = made.token.split(".")[0];
    const signed = async (words: string, secret: string) => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${words}${publicId}`)));
      return `${publicId}.${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    };
    // The test's own signing is right: the invitation's words give back the real token.
    expect(await signed("selestial.invite.v1:", TEST_LINK_SECRET)).toBe(made.token);

    const mia = s.t.withIdentity(person("mia"));
    for (const token of [await signed("selestial.link.v1:", TEST_LINK_SECRET), await signed("selestial.invite.v1:", "another-secret-that-is-long-enough-0123456789")]) {
      expect(await s.t.query(api.invitations.preview, { token })).toEqual({ state: "not_found" });
      expect(await mia.mutation(api.invitations.accept, { token })).toEqual({ status: "not_found" });
    }
    // And an invitation's token is not a cleaner's link.
    expect(await refusal(s.t.query(api.links.job, { token: made.token }))).toBe(NOT_FOUND);
  });
});

describe("who may manage invitations", () => {
  it("answers another company's Owner exactly as it answers a missing invitation", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const b = await company(s.t, "owner-b", "Beta Cleaning");
    const missing = await s.t.run(async (ctx) => {
      const row = (await ctx.db.get(made.invitationId))!;
      const id = await ctx.db.insert("invitations", { companyId: row.companyId, memberId: row.memberId, email: "gone@example.com", role: "office", publicId: "gone", status: "pending", expiresAt: 1, invitedBy: row.invitedBy, createdAt: 1, delivery: { state: "not_sent" } });
      await ctx.db.delete(id);
      return id;
    });

    for (const invitationId of [made.invitationId, missing]) {
      const calls = [
        () => b.as.mutation(api.invitations.revoke, { companyId: b.companyId, invitationId }),
        () => b.as.mutation(api.invitations.reissue, { companyId: b.companyId, invitationId }),
        () => b.as.mutation(api.invitations.link, { companyId: b.companyId, invitationId }),
      ];
      for (const call of calls) expect(await refusal(call())).toBe(NOT_FOUND);
    }
    // Reaching into Alpha directly is the same refusal, and Beta's own list has nothing of Alpha's.
    const reaching = [
      () => b.as.query(api.invitations.list, { companyId: s.companyId }),
      () => b.as.mutation(api.invitations.create, { companyId: s.companyId, email: "x@example.com", name: "X", role: "manager" }),
      () => b.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId }),
      () => b.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId }),
      () => b.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId }),
    ];
    for (const call of reaching) expect(await refusal(call())).toBe(NOT_FOUND);
    expect(await b.as.query(api.invitations.list, { companyId: b.companyId })).toEqual([]);

    // Nothing of Alpha's moved: the same link still works.
    expect(await s.listed()).toMatchObject([{ id: made.invitationId, state: "pending" }]);
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toMatchObject({ state: "pending" });
  });

  it("is the Owner only: a Manager and Office can do none of it", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    for (const who of [manager, office]) {
      const calls = [
        () => who.mutation(api.invitations.create, { companyId: s.companyId, email: "friend@example.com", name: "Friend", role: "manager" }),
        () => who.query(api.invitations.list, { companyId: s.companyId }),
        () => who.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId }),
        () => who.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId }),
        () => who.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId }),
      ];
      for (const call of calls) expect(await refusal(call())).toBe(NOT_ALLOWED);
    }
    // Signed out, the company is not there at all.
    expect(await refusal(s.t.query(api.invitations.list, { companyId: s.companyId }))).toBe(NOT_FOUND);
    expect(await refusal(s.t.mutation(api.invitations.create, { companyId: s.companyId, email: "friend@example.com", name: "Friend", role: "manager" }))).toBe(NOT_FOUND);
    expect((await s.listed()).find((row) => row.id === made.invitationId)).toMatchObject({ state: "pending" });
    expect((await s.listed()).some((row) => row.email === "friend@example.com")).toBe(false);
    // Nobody is invited as an Owner.
    await expect(s.as.mutation(api.invitations.create, { companyId: s.companyId, email: "second@example.com", name: "Second", role: "owner" } as never)).rejects.toThrow();
  });
});

describe("the invitation email", () => {
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = "mock";
    process.env.APP_ORIGIN = `${ORIGIN}/`;
  });

  it("goes out with the link, and the link is nowhere else", async () => {
    const s = await setup();
    const made = await s.invite("mia", "manager");
    expect(made.delivery).toBe("queued");
    expect(await s.listed()).toMatchObject([{ delivery: { state: "queued", at: NOW } }]);
    await flush(s.t);

    const mail = emailed("mia@example.com");
    expect(mockEmailOutbox).toHaveLength(1);
    expect(mail.token).toBe(made.token);
    expect(mail.url).toBe(`${ORIGIN}/invite/${made.token}`);
    expect(mail.subject).toBe("owner-a invited you to Alpha Cleaning on Selestial");
    expect(mail.text).toContain("Your role will be Manager.");
    expect(mail.text).toContain("This link stops working on March 8, 2027.");
    expect(mail.html).toContain(`href="${ORIGIN}/invite/${made.token}"`);
    expect(mail.html).toContain("Accept invitation");
    expect((await s.listed())[0].delivery).toMatchObject({ state: "sent" });
    expect((await s.listed())[0].delivery.problem).toBeUndefined();
    expect(await s.events("invitation.email_sent")).toHaveLength(1);

    // Nothing at rest holds the token or its signature: not a row, not an event, not a scheduled call.
    const stored = await everythingStored(s.t);
    expect(stored).toContain(made.token.split(".")[0]);
    expect(stored).not.toContain(made.token);
    expect(stored).not.toContain(made.token.split(".")[1]);
    expect(stored).not.toContain("/invite/");

    // The emailed link is the one that lets her in.
    expect(await s.t.withIdentity(person("mia")).mutation(api.invitations.accept, { token: mail.token })).toEqual({ status: "joined", companyId: s.companyId });
  });

  it("records a failure in plain words, whatever the email service did", async () => {
    const s = await setup();
    const refused = await s.invite("mia", "office", "mia@fail.test");
    const died = await s.invite("noor", "office", "noor@throw.test");
    await flush(s.t);
    const rows = await s.listed();
    expect(rows.find((row) => row.id === refused.invitationId)!.delivery).toMatchObject({ state: "failed", problem: "The email service says this address cannot receive email." });
    expect(rows.find((row) => row.id === died.invitationId)!.delivery).toMatchObject({ state: "failed", problem: "The email service did not answer, so it is not known whether the email went." });
    expect(JSON.stringify(rows)).not.toContain("mock:");
    // The two sends are scheduled together, so either may run first.
    expect(mockEmailOutbox.map((row) => row.result).sort()).toEqual(["failed", "threw"]);
    expect(await s.events("invitation.email_failed")).toHaveLength(2);
    // The invitation itself stands: the Owner can still copy the link.
    expect(await s.t.query(api.invitations.preview, { token: refused.token })).toMatchObject({ state: "pending" });
  });

  it("tries again when the email service says that may work, and sends once", async () => {
    const s = await setup();
    const made = await s.invite("mia", "office", "mia@busy.test");
    await flush(s.t);
    expect((await s.listed())[0].delivery).toMatchObject({ state: "queued", problem: "The email service is busy." });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(mockEmailOutbox.map((row) => row.result)).toEqual(["failed", "failed", "accepted"]);
    // Every try carried the same key, so a provider would drop a repeat.
    expect(new Set(mockEmailOutbox.map((row) => row.idempotencyKey)).size).toBe(1);
    expect((await s.listed())[0].delivery.state).toBe("sent");
    expect(emailed("mia@busy.test").token).toBe(made.token);
  });

  it("never sends a link that was replaced before the email went out", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    // Sent again before the first email left.
    expect(await s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId })).toEqual({ delivery: "queued" });
    const { token } = await s.as.mutation(api.invitations.link, { companyId: s.companyId, invitationId: made.invitationId });
    await flush(s.t);

    expect(mockEmailOutbox).toHaveLength(1);
    expect(emailed("mia@example.com").token).toBe(token);
    expect(JSON.stringify(mockEmailOutbox)).not.toContain(made.token);
    expect(await s.t.query(api.invitations.preview, { token: made.token })).toEqual({ state: "not_found" });
    expect((await s.listed())[0].delivery.state).toBe("sent");
  });

  it("does not send for an invitation that was closed first", async () => {
    const s = await setup();
    const made = await s.invite("mia");
    await s.as.mutation(api.invitations.revoke, { companyId: s.companyId, invitationId: made.invitationId });
    await flush(s.t);
    expect(mockEmailOutbox).toHaveLength(0);
    expect((await s.listed())[0]).toMatchObject({ state: "revoked", delivery: { state: "not_sent", problem: "The invitation was closed before the email went out." } });
  });

  it("does not send when the app's address is not set, and falls back to the site's address when it is", async () => {
    delete process.env.APP_ORIGIN;
    const s = await setup();
    const made = await s.invite("mia");
    expect(made.delivery).toBe("queued");
    await flush(s.t);
    expect(mockEmailOutbox).toHaveLength(0);
    expect((await s.listed())[0].delivery).toMatchObject({ state: "not_sent", problem: "Invitation links need setup by Selestial's team before they can be used." });

    process.env.SITE_ORIGIN = "https://selestial.test";
    await s.as.mutation(api.invitations.reissue, { companyId: s.companyId, invitationId: made.invitationId });
    await flush(s.t);
    expect(emailed("mia@example.com").url).toMatch(/^https:\/\/selestial\.test\/invite\//);
  });

  it("is not connected unless a provider is fully set up", async () => {
    const s = await setup();
    for (const [provider, index] of [["", 0], ["sendgrid", 1], ["resend", 2]] as const) {
      process.env.EMAIL_PROVIDER = provider;
      const made = await s.as.mutation(api.invitations.create, { companyId: s.companyId, email: `p${index}@example.com`, name: "P", role: "office" });
      expect(made.delivery).toBe("not_configured");
    }
    await flush(s.t);
    expect(mockEmailOutbox).toHaveLength(0);
    for (const row of await s.listed()) expect(row.delivery).toMatchObject({ state: "not_sent", problem: "Email sending isn't set up yet, so the email wasn't sent." });
  });
});

describe("creating a company", () => {
  const args = { name: "Alpha Cleaning", timezone: "America/Chicago" };
  const stored = (t: T) =>
    t.run(async (ctx) => ({
      companies: await ctx.db.query("companies").collect(),
      members: await ctx.db.query("members").collect(),
      created: (await ctx.db.query("events").collect()).filter((event) => event.type === "company.created"),
    }));

  it("makes one company for one setup key, however many times it is sent", async () => {
    const t = start();
    const owner = t.withIdentity(person("owner-a"));
    const first = await owner.mutation(api.companies.create, { ...args, setupKey: "setup-key-0001" });
    const second = await owner.mutation(api.companies.create, { ...args, setupKey: "setup-key-0001" });
    // A repeat is answered with the company already made, even if the form changed in between.
    const third = await owner.mutation(api.companies.create, { name: "Typed again", timezone: "UTC", setupKey: "setup-key-0001" });
    expect(second).toBe(first);
    expect(third).toBe(first);
    const after = await stored(t);
    expect(after.companies).toMatchObject([{ name: "Alpha Cleaning", createdBy: "owner-a", setupKey: "setup-key-0001" }]);
    expect(after.members).toMatchObject([{ role: "owner", status: "active", userId: "owner-a" }]);
    expect(after.created).toHaveLength(1);
    expect(await owner.query(api.companies.mine, {})).toEqual([{ companyId: first, name: "Alpha Cleaning", role: "owner" }]);
  });

  it("makes a company per key, per person, and every time when there is no key", async () => {
    const t = start();
    const owner = t.withIdentity(person("owner-a"));
    const ids = new Set<Id<"companies">>();
    ids.add(await owner.mutation(api.companies.create, { ...args, setupKey: "setup-key-0001" }));
    ids.add(await owner.mutation(api.companies.create, { ...args, setupKey: "setup-key-0002" }));
    // Someone else's key, even the same words, is theirs.
    ids.add(await t.withIdentity(person("owner-b")).mutation(api.companies.create, { ...args, setupKey: "setup-key-0001" }));
    ids.add(await owner.mutation(api.companies.create, args));
    ids.add(await owner.mutation(api.companies.create, args));
    expect(ids.size).toBe(5);
    const after = await stored(t);
    expect(after.companies).toHaveLength(5);
    expect(after.members).toHaveLength(5);
    expect(after.created).toHaveLength(5);
  });

  it("refuses a key that is too short or too long, and makes nothing", async () => {
    const t = start();
    const owner = t.withIdentity(person("owner-a"));
    for (const setupKey of ["", "short", "x".repeat(81)]) {
      expect(await refusal(owner.mutation(api.companies.create, { ...args, setupKey }))).toContain("8 to 80 characters");
    }
    expect((await stored(t)).companies).toEqual([]);
    await owner.mutation(api.companies.create, { ...args, setupKey: "x".repeat(8) });
    await owner.mutation(api.companies.create, { ...args, setupKey: "y".repeat(80) });
    expect((await stored(t)).companies).toHaveLength(2);
  });
});
