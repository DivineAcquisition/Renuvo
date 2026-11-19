import { describe, expect, it } from "vitest";

import { billingClassOf } from "./classify";
import { centsToUnits, dollarsToUnits, formatUnits, times, unitsToCentsCeil } from "./money";
import { priceOf, rateCardAt, RATE_CARDS } from "./rates";
import { smsRoute } from "./routes";
import { countSegments, plainPunctuation, segmentWords } from "./segments";

describe("messaging money", () => {
  it("keeps sub-cent amounts exact as whole units and shows them without rounding", () => {
    expect(formatUnits(250)).toBe("$0.025");
    expect(formatUnits(20)).toBe("$0.002");
    expect(formatUnits(1)).toBe("$0.0001");
    expect(formatUnits(250_000)).toBe("$25.00");
    expect(formatUnits(12_345_6789)).toBe("$12,345.6789");
    expect(formatUnits(-15_000)).toBe("-$1.50");
    expect(dollarsToUnits(25)).toBe(250_000);
    expect(centsToUnits(5)).toBe(500);
    expect(unitsToCentsCeil(250)).toBe(3);
    expect(() => dollarsToUnits(0.001)).toThrow();
    expect(() => times(2.5, 2)).toThrow();
    // 1,000 outbound segments: exactly $25, with no floating-point drift.
    expect(times(250, 1000)).toBe(250_000);
  });
});

describe("the launch rate card", () => {
  it("prices each route in whole units and pins the version", () => {
    const card = rateCardAt(Date.UTC(2026, 11, 1));
    expect(card.version).toBe("msg-2026-11");
    expect(priceOf(card, "sms_out", 2)).toEqual({ unitPrice: 250, amount: 500 });
    expect(priceOf(card, "sms_in", 1).amount).toBe(150);
    expect(priceOf(card, "mms_out", 1).amount).toBe(500);
    expect(priceOf(card, "mms_in", 1).amount).toBe(400);
    expect(priceOf(card, "email_out", 3).amount).toBe(60);
    expect(card.numberMonthly).toBe(30_000);
    expect(new Set(RATE_CARDS.map((c) => c.version)).size).toBe(RATE_CARDS.length);
  });
});

describe("SMS segments", () => {
  it("counts GSM-7 at 160, then 153 per segment", () => {
    expect(countSegments("a".repeat(160))).toMatchObject({ encoding: "gsm7", segments: 1 });
    expect(countSegments("a".repeat(161))).toMatchObject({ encoding: "gsm7", segments: 2 });
    expect(countSegments("a".repeat(306))).toMatchObject({ segments: 2 });
    expect(countSegments("a".repeat(307))).toMatchObject({ segments: 3 });
  });
  it("counts extension characters as two and never splits them", () => {
    expect(countSegments("€".repeat(80))).toMatchObject({ encoding: "gsm7", units: 160, segments: 1 });
    // 152 plain + one € (2 septets) does not fit the first 153-septet segment.
    expect(countSegments("a".repeat(152) + "€" + "a".repeat(10)).segments).toBe(2);
  });
  it("switches to UCS-2 for emoji and curly quotes, 70 then 67, without splitting emoji", () => {
    expect(countSegments("Hi 👋")).toMatchObject({ encoding: "ucs2", segments: 1 });
    expect(countSegments("a".repeat(70) + "’").segments).toBe(2);
    expect(countSegments("😀".repeat(35))).toMatchObject({ units: 70, segments: 1 });
    expect(countSegments("😀".repeat(36)).segments).toBe(2);
    expect(countSegments("a".repeat(66) + "😀" + "b").segments).toBe(1); // 69 code units fit one segment
    // 72 code units need two segments; the emoji moves whole into the second one (66 + 2 > 67).
    expect(countSegments("a".repeat(66) + "😀" + "bcde")).toMatchObject({ units: 72, segments: 2 });
  });
  it("flags texts over 10 segments and explains the count", () => {
    expect(countSegments("a".repeat(153 * 10 + 1)).tooLong).toBe(true);
    expect(segmentWords(countSegments("a".repeat(200)))).toBe("This message uses 2 SMS segments.");
  });
  it("replaces punctuation that forces UCS-2 without touching emoji or letters", () => {
    const text = "We’ll arrive at 9 – see you… “soon” 😀 café";
    expect(plainPunctuation(text)).toBe('We\'ll arrive at 9 - see you... "soon" 😀 café');
    expect(countSegments(plainPunctuation("It’s confirmed — thanks!")).encoding).toBe("gsm7");
  });
});

describe("routes", () => {
  it("allows standard US numbers and refuses everything without a rate", () => {
    expect(smsRoute("+15125550188")).toEqual({ ok: true });
    expect(smsRoute("+14165550188").ok).toBe(false); // Toronto
    expect(smsRoute("+17875550188").ok).toBe(false); // Puerto Rico
    expect(smsRoute("+18005550188").ok).toBe(false); // toll-free
    expect(smsRoute("+19005550188").ok).toBe(false); // premium
    expect(smsRoute("+447700900123").ok).toBe(false); // UK
    expect(smsRoute("12345").ok).toBe(false); // short code
  });
});

describe("billing class", () => {
  it("includes required replies and sign-in codes and meters business messages", () => {
    expect(billingClassOf("compliance_reply")).toBe("included");
    expect(billingClassOf("verification_code")).toBe("included");
    expect(billingClassOf("offer")).toBe("metered");
    expect(billingClassOf("customer_message")).toBe("metered");
    expect(billingClassOf("sales_follow_up")).toBe("metered");
  });
});
