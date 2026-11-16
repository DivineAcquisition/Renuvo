import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationEmail } from "./invitation";
import { emailLayout, emailText, escapeHtml } from "./layout";
import { emailProvider, mockEmailOutbox } from "./provider";

const EXPIRES = Date.UTC(2027, 2, 8, 12, 0);

describe("the email layout", () => {
  it("escapes every value it is given", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    const html = emailLayout({
      preheader: "<script>pre</script>",
      heading: "<b>Heading</b>",
      bodyHtml: "<p>Body the caller built</p>",
      action: { label: "<i>Go</i>", url: 'https://app.selestial.test/x?a=1&b="2"' },
      footnote: "<u>Foot</u>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Heading</b>");
    expect(html).not.toContain("<i>Go</i>");
    expect(html).not.toContain("<u>Foot</u>");
    expect(html).toContain("&lt;b&gt;Heading&lt;/b&gt;");
    expect(html).toContain("<p>Body the caller built</p>");
    expect(html).toContain('href="https://app.selestial.test/x?a=1&amp;b=&quot;2&quot;"');
  });

  it("is one card with the wordmark, one button and the same address as plain text", () => {
    const url = "https://app.selestial.test/invite/abc.def";
    const html = emailLayout({ preheader: "Pre", heading: "Heading", bodyHtml: "<p>Body</p>", action: { label: "Accept invitation", url } });
    expect(html).toContain("SELESTIAL");
    for (const colour of ["#6838EF", "#F8F9FC", "#FFFFFF", "#211A35", "#667085", "#E4E7EF"]) expect(html).toContain(colour);
    expect(html).toContain("max-width:600px");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html.split(url)).toHaveLength(3);
    // Built for mail programs: tables and inline styles, with nothing to load and nothing to run.
    expect(html).toContain('role="presentation"');
    for (const absent of ["<img", "<script", "<link", "<style", "@import", "url("]) expect(html).not.toContain(absent);

    const text = emailText({ heading: "Heading", lines: ["One.", "Two."], action: { label: "Accept invitation", url }, footnote: "Foot." });
    expect(text).toBe(`SELESTIAL\n\nHeading\n\nOne.\n\nTwo.\n\nAccept invitation:\n${url}\n\nFoot.\n`);
  });

  it("leaves out a button whose address is not a web address", () => {
    const html = emailLayout({ preheader: "Pre", heading: "Heading", bodyHtml: "", action: { label: "Go", url: "javascript:alert(1)" } });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("javascript:");
    expect(emailText({ heading: "Heading", lines: [], action: { label: "Go", url: "javascript:alert(1)" } })).toBe("SELESTIAL\n\nHeading\n");
  });
});

describe("the invitation email", () => {
  const input = { companyName: "Alpha Cleaning", inviterName: "Ada Owner", role: "office" as const, url: "https://app.selestial.test/invite/abc.def", expiresAt: EXPIRES, timezone: "America/Chicago" };

  it("says who invited them, to what, as what, and until which day", () => {
    const mail = invitationEmail(input);
    expect(mail.subject).toBe("Ada Owner invited you to Alpha Cleaning on Selestial");
    for (const body of [mail.text, mail.html.replace(/<[^>]+>/g, "")]) {
      expect(body).toContain("Ada Owner invited you to join Alpha Cleaning on Selestial. Your role will be Office.");
      expect(body).toContain("This link stops working on March 8, 2027.");
      expect(body).toContain("If you did not expect this invitation, you can ignore this email.");
      expect(body).toContain("Accept invitation");
      expect(body).toContain(input.url);
      // A date, never a length of time that could drift from the configured one.
      expect(body).not.toMatch(/\b\d+ (day|days|hour|hours)\b/);
      expect(body.toLowerCase()).not.toContain("password");
    }
    expect(invitationEmail({ ...input, role: "manager" }).text).toContain("Your role will be Manager.");
  });

  it("puts the day on the company's clock, and on UTC when the zone is missing or wrong", () => {
    const late = Date.UTC(2027, 2, 9, 3, 0);
    expect(invitationEmail({ ...input, expiresAt: late }).text).toContain("on March 8, 2027.");
    expect(invitationEmail({ ...input, expiresAt: late, timezone: undefined }).text).toContain("on March 9, 2027.");
    expect(invitationEmail({ ...input, expiresAt: late, timezone: "Not/AZone" }).text).toContain("on March 9, 2027.");
  });

  it("cannot be bent by a name", () => {
    const mail = invitationEmail({ ...input, companyName: `Alpha <img src=x onerror=alert(1)>\r\nBcc: someone@example.com`, inviterName: `"><script>x</script>` });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("the email provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockEmailOutbox.length = 0;
  });

  const message = { to: "mia@example.com", subject: "Subject", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "invitation-1-abc" };

  it("is not connected unless EMAIL_PROVIDER names one that is fully set up", () => {
    for (const name of ["", "smtp", "telnyx"]) {
      vi.stubEnv("EMAIL_PROVIDER", name);
      expect(emailProvider()).toBeNull();
    }
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    expect(emailProvider()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "test-key-not-real");
    expect(emailProvider()).toBeNull();
    vi.stubEnv("EMAIL_FROM", "Selestial <team@selestial.test>");
    expect(emailProvider()?.name).toBe("resend");
    vi.stubEnv("EMAIL_PROVIDER", " Mock ");
    expect(emailProvider()?.name).toBe("mock");
  });

  it("sends through Resend with the key, the sender and an idempotency key", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "test-key-not-real");
    vi.stubEnv("EMAIL_FROM", "Selestial <team@selestial.test>");
    const fetched = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetched);

    expect(await emailProvider()!.send(message)).toEqual({ ok: true, providerMessageId: "re_123" });
    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key-not-real", "Idempotency-Key": "invitation-1-abc" });
    expect(JSON.parse(String(init.body))).toEqual({ from: "Selestial <team@selestial.test>", to: ["mia@example.com"], subject: "Subject", html: "<p>Hi</p>", text: "Hi" });
  });

  it("turns every refusal into plain words, and never hands back the key or the provider's own words", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "test-key-not-real");
    vi.stubEnv("EMAIL_FROM", "team@selestial.test");
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const cases: [number, boolean][] = [[401, false], [403, false], [409, false], [422, false], [429, true], [500, true], [503, true]];
    for (const [status, retryable] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "provider_error", message: "RAW PROVIDER WORDS test-key-not-real" }), { status })));
      const result = await emailProvider()!.send(message);
      expect(result).toMatchObject({ ok: false, retryable });
      expect(JSON.stringify(result)).not.toContain("RAW PROVIDER WORDS");
      expect(JSON.stringify(result)).not.toContain("test-key-not-real");
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND api.resend.com test-key-not-real"); }));
    expect(await emailProvider()!.send(message)).toEqual({ ok: false, retryable: true, problem: "The email service could not be reached." });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
