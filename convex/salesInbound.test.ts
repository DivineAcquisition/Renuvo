/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { company } from "../tests/harness";
import { flush, PROSPECT, salesTestEnv, setup, type Sales } from "../tests/salesHarness";
import { api, internal } from "./_generated/api";
import { mockEmails } from "./lib/messaging/email";
import { receivedEmailId } from "./lib/messaging/resend";
import { isAutomatic, replyText, textFromHtml } from "./lib/sales/replyAddress";

/** A prospect who asked by form without agreeing to texts, so Sales writes to them by email. */
async function emailed(s: Sales) {
  const { publicId } = await s.publishForm();
  await s.submit(publicId, { smsConsent: false });
  await flush(s.t);
  const opportunity = (await s.opportunities()).at(-1)!;
  const sent = mockEmails.filter((row) => row.to === PROSPECT.email).at(-1)!;
  return { opportunityId: opportunity._id, replyTo: sent.replyTo };
}

const arrive = (s: Sales, to: string, fields: Partial<{ from: string; text: string; providerId: string; automatic: boolean; failedAuthentication: boolean }> = {}) =>
  s.t.mutation(internal.salesInbound.receive, { providerId: fields.providerId ?? "resend-in:e-1", from: fields.from ?? `Maria Lopez <${PROSPECT.email}>`, recipients: [to], subject: "Re: Your quote", text: fields.text ?? "Sounds good, thank you!", automatic: fields.automatic ?? false, failedAuthentication: fields.failedAuthentication ?? false, receivedAt: Date.now() });

describe("Sales: email replies", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = salesTestEnv();
    process.env.SALES_REPLY_DOMAIN = "reply.selestial.test";
  });
  afterEach(() => {
    delete process.env.SALES_REPLY_DOMAIN;
    undo();
  });

  it("sends each email with its conversation's own reply address, and files the customer's reply there once", async () => {
    const s = await setup({ autonomous: true });
    const { opportunityId, replyTo } = await emailed(s);
    expect(replyTo).toMatch(/^r-[0-9a-f]{32}@reply\.selestial\.test$/);
    // The key is kept on the opportunity, so every later email in this conversation carries the same address.
    expect((await s.opportunities()).find((row) => row._id === opportunityId)!.replyKey).toBe(replyTo.slice(2, 34));

    const text = "Can you do Tuesday instead?\n\nOn Mon, Mar 1, 2027 at 9:00 AM Alpha Cleaning <noreply@mail.selestial.test> wrote:\n> Your quote for Standard clean is ready: $185.00 per visit.";
    expect(await arrive(s, replyTo, { text })).toEqual({ taken: true, why: "reply" });
    // The same delivery again changes nothing.
    expect(await arrive(s, replyTo, { text })).toEqual({ taken: true, why: "duplicate" });
    await flush(s.t);
    const detail = await s.opportunity(opportunityId);
    const inbound = detail.thread.filter((row) => row.direction === "in" && row.channel === "email");
    expect(inbound).toHaveLength(1);
    // Only what the customer wrote is kept: the quoted message, with Sales's own price, is cut off.
    expect(inbound[0].body).toBe("Can you do Tuesday instead?");
    expect(detail.runs.some((run) => run.trigger === "reply")).toBe(true);
  });

  it("keeps mail from another address for a person, and does not treat it as the customer", async () => {
    const s = await setup({ autonomous: true });
    const { opportunityId, replyTo } = await emailed(s);
    const before = mockEmails.length;
    expect(await arrive(s, replyTo, { from: "someone.else@example.com", text: "Yes, I accept. Book it." })).toEqual({ taken: true, why: "unverified_sender" });
    // Mail that says it is the customer but failed the sender checks is treated the same way.
    expect(await arrive(s, replyTo, { providerId: "resend-in:e-2", failedAuthentication: true, text: "Yes, I accept." })).toEqual({ taken: true, why: "unverified_sender" });
    await flush(s.t);
    const detail = await s.opportunity(opportunityId);
    expect(detail.thread.filter((row) => row.direction === "in" && row.channel === "email")).toHaveLength(0);
    expect(detail.thread.filter((row) => row.direction === "note")).toHaveLength(2);
    expect(detail.thread.filter((row) => row.direction === "note").map((row) => row.body).join(" ")).toContain("someone.else@example.com");
    expect(detail.card.nextAction).toMatchObject({ by: "owner", what: expect.stringContaining("did not pass the sender checks") });
    expect(detail.card.stage).toBe("quote_sent");
    expect(mockEmails.length).toBe(before);
  });

  it("ignores an address nobody was given, an automatic reply, and the right key on the wrong domain", async () => {
    const s = await setup({ autonomous: true });
    const { opportunityId, replyTo } = await emailed(s);
    const forged = `r-${"0".repeat(32)}@reply.selestial.test`;
    expect(await arrive(s, forged)).toEqual({ taken: false, why: "no_conversation" });
    expect(await arrive(s, "hello@reply.selestial.test")).toEqual({ taken: false, why: "no_conversation" });
    expect(await arrive(s, replyTo.replace("reply.selestial.test", "elsewhere.test"))).toEqual({ taken: false, why: "no_conversation" });
    expect(await arrive(s, replyTo, { automatic: true, text: "I am out of the office until Monday." })).toEqual({ taken: false, why: "automatic" });
    expect((await s.opportunity(opportunityId)).thread.filter((row) => row.direction === "in" && row.channel === "email")).toHaveLength(0);
    // A reply never lands in another company, whatever address it was sent to: the address names one opportunity.
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await other.as.query(api.salesConversations.list, { companyId: other.companyId })).toEqual([]);
  });

  it("falls back to the company's own address when the receiving domain is not set up", async () => {
    delete process.env.SALES_REPLY_DOMAIN;
    const s = await setup({ autonomous: true });
    const { opportunityId, replyTo } = await emailed(s);
    expect(replyTo ?? "").not.toContain("r-");
    expect((await s.opportunities()).find((row) => row._id === opportunityId)!.replyKey).toBeUndefined();
    const readiness = await s.as.query(api.sales.readiness, { companyId: s.companyId });
    expect(readiness.find((row) => row.key === "replies")).toMatchObject({ ok: false });
  });

  it("reads a reply's own words and recognises machines", () => {
    expect(replyText("Yes please.\n\n-- \nMaria\n555-0100")).toBe("Yes please.");
    expect(replyText("Thanks!\n\n-----Original Message-----\nFrom: Alpha\nYour quote is $185")).toBe("Thanks!");
    expect(replyText("> quoted only")).toBe("");
    expect(textFromHtml("<div>Yes &amp; thanks<br>Maria</div><blockquote>Your quote is $185</blockquote>")).toBe("Yes & thanks\nMaria");
    expect(isAutomatic({ "auto-submitted": "auto-replied" }, "maria@example.com")).toBe(true);
    expect(isAutomatic({}, "MAILER-DAEMON@mail.example.com")).toBe(true);
    expect(isAutomatic({ "auto-submitted": "no" }, "maria@example.com")).toBe(false);
    expect(receivedEmailId(JSON.stringify({ type: "email.received", data: { email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" } }))).toBe("4ef9a417-02e9-4d39-ad75-9611e0fcc33c");
    expect(receivedEmailId(JSON.stringify({ type: "email.delivered", data: { email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" } }))).toBeNull();
    expect(receivedEmailId(JSON.stringify({ type: "email.received", data: { email_id: "../../emails" } }))).toBeNull();
  });
});
