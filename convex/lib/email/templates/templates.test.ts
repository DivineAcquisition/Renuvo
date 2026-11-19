import { describe, expect, it } from "vitest";

import { action, renderEmail, safeAccent, TOKENS, webAddress } from "../kit";
import { bookingConfirmationEmail, conversationEmail } from "./company";
import { PREVIEWS, SAMPLE_BRAND } from "./gallery";
import { agentApprovalEmail, securityEmail, weeklyDigestEmail, welcomeEmail } from "./platform";

const ORIGIN = "https://app.selestial.test";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const visible = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");

describe("every email in the gallery", () => {
  it("has the ten representative emails the brief asks for", () => {
    for (const id of ["welcome", "security", "approval", "escalation", "digest", "booking", "proposal", "applicant", "payment-failure", "inbox-reconnect"]) expect(PREVIEWS.map((p) => p.id)).toContain(id);
  });

  for (const preview of PREVIEWS) {
    describe(preview.name, () => {
      const mail = preview.render(ORIGIN);

      it("has a one-line subject and preheader", () => {
        expect(mail.subject.length).toBeGreaterThan(10);
        expect(mail.subject.length).toBeLessThanOrEqual(110);
        expect(mail.subject).not.toMatch(/[\r\n]/);
        expect(mail.preheader.length).toBeGreaterThan(20);
        expect(mail.preheader).not.toMatch(/[\r\n]/);
      });

      it("is built for mail programs: a 600px table layout, no scripts, nothing external but its own images", () => {
        expect(mail.html.startsWith("<!doctype html>")).toBe(true);
        expect(mail.html).toContain("max-width:600px");
        expect(mail.html).toContain('role="presentation"');
        expect(mail.html).toContain('<meta name="color-scheme" content="light dark">');
        for (const absent of ["<script", "<link", "@import", "url(", "<form", "<iframe", "javascript:"]) expect(mail.html).not.toContain(absent);
        for (const src of [...mail.html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1])) {
          expect(src.startsWith(`${ORIGIN}/email/`)).toBe(true);
          expect(src.endsWith(".png")).toBe(true);
        }
        // Every image says what it is (or is marked decorative).
        for (const img of mail.html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/alt="/);
      });

      it("has at most one button, and every link is a web address the plain text also carries", () => {
        expect((mail.html.match(/v:roundrect /g) ?? []).length).toBeLessThanOrEqual(1);
        for (const href of hrefs(mail.html)) {
          expect(webAddress(href)).toBe(href);
          expect(mail.text).toContain(href);
        }
      });

      it("never shows a missing value as a word", () => {
        for (const body of [mail.text, visible(mail.html), mail.subject, mail.preheader]) expect(body).not.toMatch(/\b(undefined|null|NaN|Invalid Date)\b|\[object/);
      });

      it("says why the person got it, and who it's from", () => {
        if (preview.kind === "company") {
          expect(mail.text).toContain(`${SAMPLE_BRAND.name} · sent via Selestial`);
          expect(mail.text).not.toContain("Software for cleaning companies");
        } else {
          expect(mail.text).toContain("Selestial");
        }
        expect(mail.text).toMatch(/You're getting this because|If you did not expect this invitation/);
      });
    });
  }

  it("leaves images and app links out, rather than guessing, when the app's address isn't known", () => {
    for (const preview of PREVIEWS.filter((p) => p.kind === "platform")) {
      const mail = preview.render(null);
      expect(mail.html).not.toContain("<img");
      for (const href of hrefs(mail.html)) expect(href.startsWith("https://app.selestial.io/invite/")).toBe(true);
    }
  });
});

describe("what the emails promise", () => {
  it("never lets a link approve, accept or sign: the approval opens the review page and says so", () => {
    const mail = PREVIEWS.find((p) => p.id === "approval")!.render(ORIGIN);
    expect(hrefs(mail.html)).toContain(`${ORIGIN}/app/approvals?open=approval:sample`);
    expect(mail.text).toContain("Opening this doesn't approve anything.");
    const proposal = PREVIEWS.find((p) => p.id === "proposal")!.render(ORIGIN);
    expect(proposal.text).toContain("Opening the proposal doesn't accept it.");
  });

  it("keeps security and account notices separate from preferences: no unsubscribe, always-sent wording", () => {
    for (const id of ["security", "payment-failure", "inbox-reconnect"]) {
      const mail = PREVIEWS.find((p) => p.id === id)!.render(ORIGIN);
      expect(mail.text).not.toMatch(/unsubscribe/i);
      expect(mail.text).toContain("Security and account notices are always sent.");
    }
  });

  it("says a quiet week was quiet instead of inventing activity", () => {
    const mail = weeklyDigestEmail({ origin: ORIGIN, companyName: "Alpha", role: "owner", weekStart: 0, weekEnd: 6 * 86_400_000, visitsDone: 0, visitsCancelled: 0, paidCents: 0, decisionsMade: 0, waiting: [], sections: [{ heading: "Hiring", items: [], empty: "No new applicants." }] });
    expect(mail.text).toContain("It was a quiet week: nothing was recorded for this company.");
    expect(mail.text).toContain("Nothing is waiting on you.");
    expect(mail.text).toContain("No new applicants.");
    expect(mail.subject).toBe("Your week at Alpha");
  });

  it("only shows the steps it was given, and changes the button once setup is done", () => {
    const left = welcomeEmail({ origin: ORIGIN, companyName: "Alpha", role: "owner", steps: [{ label: "Add cleaners", done: false }] });
    expect(left.text).toContain("- Add cleaners (To do)");
    expect(left.text).toContain("Continue setup:");
    const done = welcomeEmail({ origin: ORIGIN, companyName: "Alpha", role: "owner", steps: [{ label: "Add cleaners", done: true }] });
    expect(done.text).toContain("Open Selestial:");
  });

  it("leaves out a fact it doesn't have instead of filling it", () => {
    const mail = agentApprovalEmail({ origin: ORIGIN, companyName: "Alpha", role: "manager", agent: "dispatch", approvalId: "a1", summary: "Offer the visit to Sam", reason: "Ana declined.", decideBy: Date.UTC(2026, 10, 18, 18), timezone: "America/Chicago", about: [{ label: "Customer", value: null }, { label: "Visit", value: "Standard clean" }] });
    expect(mail.text).not.toContain("Customer:");
    expect(mail.text).toContain("Visit: Standard clean");
    expect(mail.text).not.toContain("Approving lets it");
    expect(mail.text).toContain("Decide by: Wednesday, November 18 at 12:00 PM");
  });
});

describe("safety", () => {
  it("escapes every value from a record, in the body, the facts and the subject", () => {
    const evil = `Acme <img src=x onerror=alert(1)>\r\nBcc: x@example.com`;
    const mail = securityEmail({ origin: ORIGIN, companyName: evil, role: "owner", byName: `"><script>x</script>`, at: 0, change: { kind: "member_removed", memberName: "<b>Sam</b>" } });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain("<b>Sam</b>");
    expect(mail.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.preheader).not.toMatch(/[\r\n]/);
  });

  it("drops a link that isn't a web address", () => {
    expect(action({ label: "Go", url: "javascript:alert(1)" }).html).toBe("");
    const booking = bookingConfirmationEmail({ brand: SAMPLE_BRAND, service: "Clean", startsAt: 0, lines: [], totalCents: 0, manageUrl: "data:text/html,hi" });
    expect(booking.html).not.toContain("data:text");
    expect(booking.text).not.toContain("data:text");
  });

  it("keeps a company's accent only when white text on it is readable", () => {
    expect(safeAccent("#0E7C66")).toBe("#0E7C66");
    expect(safeAccent("#ffeb3b")).toBe(TOKENS.violet);
    expect(safeAccent("#ffffff")).toBe(TOKENS.violet);
    expect(safeAccent("red; background:url(x)")).toBe(TOKENS.violet);
    expect(safeAccent(null)).toBe(TOKENS.violet);
  });

  it("turns a company logo address that isn't https into the company's name as text", () => {
    const { html } = renderEmail({ identity: { kind: "company", name: "Alpha", logoUrl: "javascript:x", viaSelestial: true }, preheader: "Hi there friend", blocks: [], footer: { reason: "Because." } });
    expect(html).not.toContain("<img");
    expect(html).toContain(">Alpha</span>");
  });
});

describe("a connected-inbox conversation", () => {
  it("reads like a person wrote it: no frame, no logo, no footer, just the words and a short signature", () => {
    const mail = conversationEmail({ paragraphs: ["Hi Karen,", "Thanks for getting back to me. Biweekly works.\nI've updated the quote."], link: { label: "Your updated quote", url: "https://link.selestial.io/p/abc" }, signature: { name: "Devon", company: "Sparkle & Shine Cleaning", phone: "(214) 555-0142" } });
    for (const absent of ["<table", "<img", "via Selestial", "Notification settings", "<style", "<!doctype"]) expect(mail.html).not.toContain(absent);
    expect(mail.text).toBe("Hi Karen,\n\nThanks for getting back to me. Biweekly works.\nI've updated the quote.\n\nYour updated quote: https://link.selestial.io/p/abc\n\nDevon\nSparkle & Shine Cleaning\n(214) 555-0142\n");
    expect(mail.html).toContain("Biweekly works.<br>I&#39;ve updated the quote.");
  });
});
