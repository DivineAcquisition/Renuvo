import { describe, expect, it } from "vitest";

import { can, capabilitiesOf, mayRead, readableClasses } from "./access";
import { DOC_TYPES, SUPPORTING_KINDS, variablesFor } from "./catalog";
import { CLAUSE_BY_KEY, CLAUSES, variablesOf } from "./clauses";
import { addMonths, affectedClauses, contentHash, isIsoDate, kitFor, missingRequired, render, validate } from "./compose";
import { diffLines } from "./diff";
import { sha256 } from "./hash";
import { coerce, nextQuestions, openQuestions } from "./intake";
import { reviewNotes } from "./legal";
import { markdownToPdf } from "./pdf";
import { signBody, verifyBody, parseEvent } from "./signing";
import { VARIABLE_BY_KEY, VARIABLES } from "./variables";
import { classify, checkFile } from "./upload";

describe("the catalog", () => {
  it("covers every document family the product promises, once each, with honest readiness", () => {
    const keys = DOC_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = DOC_TYPES.map((t) => t.label);
    for (const wanted of [
      "One-Time Residential Cleaning", "Recurring Residential Cleaning", "Deep Cleaning", "Move-In / Move-Out Cleaning", "Commercial Master Service Agreement", "Office / Janitorial Cleaning",
      "Short-Term Rental / Vacation Rental Turnover", "Property Management / Multi-Property Cleaning", "Post-Construction Cleaning", "Event, Emergency, and After-Hours Cleaning",
      "Independent Contractor Agreement", "Subcontractor Company Agreement", "Employee Offer Letter", "Employment Terms / Employment Agreement", "Confidentiality & Customer Privacy Agreement", "Employee Handbook / Policy Acknowledgment",
      "Equipment and Uniform Issuance / Return", "Keys, Alarm Codes, and Property Access Acknowledgment", "Safety and Training Acknowledgment", "Compensation Change Addendum", "Background-Check Disclosure and Authorization", "Separation and Offboarding Documents",
      "Scope of Work / Cleaning Schedule", "Property / Location Schedule", "Pricing and Payment Schedule", "Change Order / Additional Work Authorization", "Recurring Payment Authorization", "Property Access / Key-Holding Authorization",
      "STR Laundry, Linen, and Restocking Addendum", "Property Condition / Sensitive Surface Acknowledgment", "Service Documentation Photo Authorization", "Marketing Photo / Testimonial Release", "Renewal / Extension / Price Amendment", "Service Pause / Cancellation / Termination Notice", "Corrective Service / Re-clean Arrangement",
      "Vendor / Supplier Service Agreement", "Equipment Rental Agreement", "Referral / Partnership Agreement", "Commercial Confidentiality Agreement", "Customer-required Data Processing Addendum",
    ]) expect(labels, wanted).toContain(wanted);
    expect(labels.some((l) => l.startsWith("Specialty Cleaning"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Specialized Facility"))).toBe(true);
    // Worker status, pay and separation documents need a specialist; none claims to be reviewed.
    for (const key of ["contractor_agreement", "employee_offer", "employment_agreement", "background_disclosure", "separation_offboarding", "compensation_change"]) expect(DOC_TYPES.find((t) => t.key === key)?.readiness, key).toBe("specialist_review");
    expect(DOC_TYPES.every((t) => !("legallyReviewed" in t))).toBe(true);
    // Documents are separate kinds, and every kind is used.
    expect(new Set(DOC_TYPES.map((t) => t.kind))).toEqual(new Set(["base", "scope", "schedule", "addendum", "authorization", "acknowledgment", "notice"]));
    // Official forms are supporting records, never generated.
    expect(SUPPORTING_KINDS.map((k) => k.key)).toEqual(expect.arrayContaining(["insurance_certificate", "license", "tax_form", "employment_form"]));
    expect(DOC_TYPES.some((t) => /W-?9|I-?9|W-?4/.test(t.label))).toBe(false);
  });

  it("is made of shared clauses and defined variables, with nothing dangling", () => {
    for (const type of DOC_TYPES) {
      for (const key of type.clauses) expect(CLAUSE_BY_KEY.has(key), `${type.key} -> ${key}`).toBe(true);
      expect(() => variablesFor(type), type.key).not.toThrow();
    }
    for (const c of CLAUSES) {
      for (const v of variablesOf(c.body)) expect(VARIABLE_BY_KEY.has(v), `${c.key} {{${v}}}`).toBe(true);
      for (const gate of [c.when, c.unless]) if (gate) expect(VARIABLE_BY_KEY.has(gate)).toBe(true);
    }
    // Shared, not copied: the same clause serves many types, and no two clauses carry the same text.
    const uses = new Map<string, number>();
    for (const type of DOC_TYPES) for (const key of type.clauses) uses.set(key, (uses.get(key) ?? 0) + 1);
    expect(uses.get("parties")).toBeGreaterThan(10);
    expect(uses.get("signatures")).toBeGreaterThan(30);
    expect(new Set(CLAUSES.map((c) => c.body)).size).toBe(CLAUSES.length);
    for (const v of VARIABLES) expect(v.ask).toContain("?");
  });

  it("keeps standalone and sensitive provisions out of documents that should not have them", () => {
    const all = CLAUSES.map((c) => `${c.title} ${c.body}`).join("\n").toLowerCase();
    for (const banned of ["non-compete", "noncompete", "arbitration", "personal guarantee", "waive", "waiver", "hold harmless"]) expect(all, banned).not.toContain(banned);
    // The background-check disclosure is its own document, and no other document includes it.
    const holders = DOC_TYPES.filter((t) => t.clauses.includes("background_disclosure")).map((t) => t.key);
    expect(holders).toEqual(["background_disclosure"]);
    // Photo permission for documentation and for advertising are different clauses in different documents.
    expect(DOC_TYPES.find((t) => t.key === "photo_authorization")!.clauses).not.toContain("marketing_release");
    expect(DOC_TYPES.find((t) => t.key === "marketing_release")!.clauses).not.toContain("photo_documentation");
  });
});

describe("composing", () => {
  const type = DOC_TYPES.find((t) => t.key === "recurring_residential")!;
  it("shows an unknown fact as TO CONFIRM and never invents one", () => {
    const out = render(type, { companyName: "Elm Cleaning" });
    expect(out.markdown).toContain("Elm Cleaning");
    expect(out.unresolved).toContain("Customer or other party");
    expect(out.markdown).not.toMatch(/undefined|\{\{/);
    expect(out.clauses.every((c) => c.version >= 1)).toBe(true);
  });

  it("includes a gated clause only when its answer says it applies", () => {
    const base = { companyName: "A", counterpartyName: "B" };
    expect(render(type, base).markdown).not.toContain("Deposit");
    expect(render(type, { ...base, depositCents: 0 }).markdown).not.toContain("Deposit");
    expect(render(type, { ...base, depositCents: 5000 }).markdown).toContain("$50.00");
    expect(render(type, { ...base, autoRenew: true }).markdown).toContain("renews automatically");
    expect(render(type, { ...base, autoRenew: false }).markdown).toContain("ends at the end of the term");
    expect(render(type, base).markdown).not.toMatch(/renews automatically|ends at the end of the term/);
  });

  it("asks two or three questions at a time, never an answered one, and only about clauses in use", () => {
    const first = nextQuestions(type, {});
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(new Set(first.map((q) => q.group)).size).toBeLessThanOrEqual(2);
    const after = nextQuestions(type, Object.fromEntries(first.map((q) => [q.key, q.type === "money" || q.type === "int" ? 1 : "x"])));
    expect(after.map((q) => q.key).filter((k) => first.some((f) => f.key === k))).toEqual([]);
    expect(openQuestions(type, {}).map((q) => q.key)).not.toContain("poNumber");
    const skipped = nextQuestions(type, {}, [first[0].key]);
    expect(skipped.map((q) => q.key)).not.toContain(first[0].key);
    // Branching by type: STR asks about turnovers, commercial about sites, contractors about the worker.
    const str = DOC_TYPES.find((t) => t.key === "str_turnover")!;
    expect(openQuestions(str, {}).map((q) => q.key)).toEqual(expect.arrayContaining(["turnoverDeadline", "linenBy", "restockItems", "emergencyAuthCents", "bookingChangeNoticeHours"]));
    const office = DOC_TYPES.find((t) => t.key === "office_janitorial")!;
    expect(openQuestions(office, {}).map((q) => q.key)).toEqual(expect.arrayContaining(["siteList", "afterHoursAccess", "consumablesBy", "inspectionCadence", "authorizedContacts", "purchaseOrderRequired"]));
    expect(openQuestions(office, { purchaseOrderRequired: true }).map((q) => q.key)).toContain("poNumber");
    const contractor = DOC_TYPES.find((t) => t.key === "contractor_agreement")!;
    expect(openQuestions(contractor, {}).map((q) => q.key)).toEqual(expect.arrayContaining(["workerName", "workLocation", "payRateText", "responsibilities", "setsOwnSchedule", "ownEquipment"]));
    expect(openQuestions(contractor, {}).map((q) => q.key)).not.toContain("handbookVersion");
  });

  it("checks facts the same way every time", () => {
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-03-15", 12)).toBe("2028-03-15");
    expect(validate(type, { pricePerVisitCents: -5 }).errors).toHaveLength(1);
    expect(validate(type, { paymentDueDays: 2.5 }).errors).toHaveLength(1);
    expect(validate(type, { governingState: "Texas" }).errors[0].message).toMatch(/two-letter/);
    expect(validate(type, { autoRenew: true, termMonths: 6, renewalNoticeDays: 400 }).errors.map((e) => e.field)).toContain("renewalNoticeDays");
    expect(validate(type, { frequency: "one time", termMonths: 6 }).errors.map((e) => e.field)).toContain("termMonths");
    const contractor = DOC_TYPES.find((t) => t.key === "contractor_agreement")!;
    expect(validate(contractor, { payBasis: "salary" }).errors).toHaveLength(1);
    expect(validate(contractor, { setsOwnSchedule: false, ownEquipment: false }).warnings[0].message).toMatch(/title does not decide/);
    expect(missingRequired(type, {})).toContain("serviceName");
    expect(missingRequired(type, {})).not.toContain("depositCents");
  });

  it("names the clauses a changed answer touches", () => {
    const touched = affectedClauses(type, { pricePerVisitCents: 1 }, { pricePerVisitCents: 2 });
    expect(touched.map((c) => c.title)).toEqual(["Price and payment"]);
    expect(affectedClauses(type, {}, { depositCents: 100 }).map((c) => c.title)).toEqual(expect.arrayContaining(["Deposit"]));
    expect(affectedClauses(type, { pricePerVisitCents: 1 }, { pricePerVisitCents: 1 })).toEqual([]);
  });

  it("coerces typed answers and refuses bad ones", () => {
    const money = VARIABLE_BY_KEY.get("pricePerVisitCents")!;
    expect(coerce(money, "$1,234.5")).toEqual({ ok: true, value: 123450 });
    expect(coerce(money, "abc").ok).toBe(false);
    expect(coerce(VARIABLE_BY_KEY.get("autoRenew")!, "Yes")).toEqual({ ok: true, value: true });
    expect(coerce(VARIABLE_BY_KEY.get("governingState")!, "tx")).toEqual({ ok: true, value: "TX" });
    expect(coerce(VARIABLE_BY_KEY.get("frequency")!, "WEEKLY")).toEqual({ ok: true, value: "weekly" });
    expect(coerce(VARIABLE_BY_KEY.get("frequency")!, "hourly").ok).toBe(false);
    expect(coerce(VARIABLE_BY_KEY.get("areasIncluded")!, "kitchen; baths, halls")).toEqual({ ok: true, value: ["kitchen", "baths", "halls"] });
  });

  it("hashes text exactly, and compares versions line by line", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(contentHash("a\r\nb")).toBe(contentHash("a\nb"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
    const d = diffLines("one\ntwo\nthree", "one\n2\nthree\nfour");
    expect(d.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["two"]);
    expect(d.filter((l) => l.kind === "added").map((l) => l.text)).toEqual(["2", "four"]);
  });

  it("writes a valid PDF of the exact text, across pages", () => {
    const long = `# Title\n\n${Array.from({ length: 120 }, (_, i) => `## ${i + 1}. Clause\n\nSome (parenthetical) text with “quotes” and a long run of words to wrap onto several lines properly. ${"word ".repeat(40)}`).join("\n\n")}`;
    const bytes = markdownToPdf(long, { title: "Test", footer: "v1" });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(3);
    expect(text).toContain("Page 1 of " + pages);
    expect(text).toContain("\\(parenthetical\\)");
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
  });
});

describe("access", () => {
  it("separates workforce and restricted documents from customer ones", () => {
    expect(readableClasses("office")).toEqual(["company"]);
    expect(readableClasses("manager")).toEqual(["company", "workforce"]);
    expect(readableClasses("owner")).toEqual(["company", "workforce", "restricted"]);
    expect(mayRead("manager", "restricted")).toBe(false);
    for (const type of DOC_TYPES) if (["contractor_agreement", "employee_offer", "employment_agreement", "compensation_change", "background_disclosure", "separation_offboarding", "subcontractor_agreement"].includes(type.key)) expect(type.access, type.key).toBe("restricted");
    expect(DOC_TYPES.filter((t) => t.category === "customer").every((t) => t.access === "company")).toBe(true);
    expect(capabilitiesOf("office")).toEqual(["view", "draft"]);
    expect(can("manager", "viewRestricted")).toBe(false);
    expect(can("manager", "send")).toBe(true);
    expect(can("office", "approve")).toBe(false);
  });
});

describe("legal prompts", () => {
  it("name the topic and the state, say what is general, and never claim compliance", () => {
    const notes = reviewNotes(["classification", "restrictive", "auto_renewal", "wage"], "CA");
    expect(notes.map((n) => n.topic)).toEqual(["classification", "restrictive", "auto_renewal", "wage"]);
    expect(notes[0].why).toMatch(/ABC test/);
    expect(notes[0].severity).toBe("specialist");
    expect(reviewNotes(["classification"], "ND")[0].why).toMatch(/none are summarized here for ND/);
    expect(reviewNotes(["deposit"], undefined)[0].why).toMatch(/No state was given/);
    expect(JSON.stringify(notes)).not.toMatch(/\bis compliant\b|\bis enforceable\b|guarantee/i);
    expect(reviewNotes([], "TX", { autoRenew: true }).map((n) => n.topic)).toEqual(["auto_renewal"]);
  });
});

describe("uploads and webhooks", () => {
  it("validates a file by its real bytes and size, and suggests a type without deciding it", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(checkFile({ name: "a.pdf", contentType: "application/pdf", size: 100, head: pdf }).ok).toBe(true);
    expect(checkFile({ name: "a.pdf", contentType: "application/pdf", size: 100, head: new Uint8Array([1, 2, 3]) }).ok).toBe(false);
    expect(checkFile({ name: "a.exe", contentType: "application/x-msdownload", size: 100, head: pdf }).ok).toBe(false);
    expect(checkFile({ name: "a.pdf", contentType: "image/png", size: 100, head: pdf }).ok).toBe(false);
    expect(checkFile({ name: "a.pdf", contentType: "application/pdf", size: 16 * 1024 * 1024, head: pdf }).ok).toBe(false);
    expect(checkFile({ name: "a.txt", contentType: "text/plain", size: 10, head: new Uint8Array([104, 0, 105]) }).ok).toBe(false);
    expect(classify("w-9-form.pdf", null)).toMatchObject({ classification: "supporting", supportingKind: "tax_form" });
    expect(classify("notes.txt", "Recurring residential cleaning agreement between the parties")).toMatchObject({ classification: "agreement", docType: "recurring_residential" });
    expect(classify("misc.txt", "lorem ipsum")).toMatchObject({ classification: "unknown" });
  });

  it("believes a webhook only when it is signed with the secret, and parses only well-formed events", async () => {
    const body = JSON.stringify({ eventId: "e1", requestId: "r1", type: "signed", signerEmail: " Pat@Example.com ", at: 5 });
    const good = await signBody("s3cret", body);
    expect(await verifyBody("s3cret", good, body)).toBe(true);
    expect(await verifyBody("s3cret", good, `${body} `)).toBe(false);
    expect(await verifyBody("other", good, body)).toBe(false);
    expect(await verifyBody(undefined, good, body)).toBe(false);
    expect(await verifyBody("s3cret", null, body)).toBe(false);
    expect(parseEvent(body)).toMatchObject({ eventId: "e1", signerEmail: "pat@example.com", type: "signed" });
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent(JSON.stringify({ eventId: "e", requestId: "r", type: "signed_by_magic" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ requestId: "r", type: "signed" }))).toBeNull();
  });

  it("builds a complete document for every type from complete answers, leaving only the text that needs a lawyer", () => {
    for (const type of DOC_TYPES) {
      const kit = kitFor(type);
      const terms: Record<string, string | number | boolean | string[]> = {};
      for (const v of VARIABLES) terms[v.key] = v.type === "money" || v.type === "int" ? 1 : v.type === "bool" ? true : v.type === "list" ? ["x"] : v.type === "date" ? "2027-03-02" : v.choices?.[0] ?? "x";
      const out = render(type, terms, { kit });
      const needsCounsel = out.unresolved.filter((u) => !/reviewed by counsel|supplied by the screening provider|required by federal|any limitation|final pay timing/i.test(u));
      expect(needsCounsel, type.key).toEqual([]);
    }
  });
});
