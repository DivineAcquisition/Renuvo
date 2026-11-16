/**
 * @vitest-environment edge-runtime
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refusal, start } from "../tests/harness";
import { ADMIN, OUTSIDER, staffSetup } from "../tests/trustHarness";
import { api, internal } from "./_generated/api";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { publicQueryViolations, trustChangeLogViolations } from "./lib/guard";
import { DOCUMENT_VERSIONS } from "./lib/trust/documents";
import { SEED, SEED_APPROVAL_NOTE, SEED_PUBLIC_SNAPSHOT } from "./lib/trust/seed";

const claim = {
  key: "links-scoped",
  area: "links" as const,
  text: "Task links sent to cleaners work only for that cleaner's assignment.",
  evidence: "convex/linkAudit.test.ts",
  status: "implemented_verified" as const,
  reviewedOn: "2026-11-16",
  public: true,
  note: "Wording shortened.",
};

describe("the trust registry", () => {
  beforeEach(() => {
    process.env.STAFF_BOOTSTRAP_EMAIL = ADMIN.email;
  });
  afterEach(() => {
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  it("seeds once: running it again adds nothing and keeps what staff changed", async () => {
    const t = start();
    expect(await t.mutation(internal.trust.seed, {})).toEqual({ settings: 1, providers: SEED.providers.length, claims: SEED.claims.length, publications: DOCUMENT_VERSIONS.length });
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.trust.upsertClaim, { ...claim, note: "Edited after seeding." });
    expect(await t.mutation(internal.trust.seed, {})).toEqual({ settings: 0, providers: 0, claims: 0, publications: 0 });
    const record = await admin.query(api.trust.admin, {});
    expect(record.seeded).toBe(true);
    expect(record.claims.find((row) => row.key === "links-scoped")?.text).toBe(claim.text);
    expect(record.providers).toHaveLength(SEED.providers.length);
    // Every document version is published, with the owner's approval note.
    expect(record.publications.map((row) => [row.documentId, row.status, row.approvalNote])).toEqual(DOCUMENT_VERSIONS.map((version) => [version.id, "published", SEED_APPROVAL_NOTE]));
  });

  it("seeds only what can be pointed at: no locations, agreements or deadlines as fact", () => {
    for (const provider of SEED.providers) {
      expect(provider.locations, provider.key).toBeNull();
      expect(provider.agreementRef, provider.key).toBeNull();
    }
    const live = SEED.providers.filter((row) => row.status !== "planned").map((row) => row.key);
    expect(live).toEqual(["clerk", "convex", "vercel", "resend"]);
    expect(SEED.providers.find((row) => row.key === "resend")?.status).toBe("connected_not_live");
    // Every public claim is verified; the sale-of-data sentence waits for the owner.
    for (const row of SEED.claims) if (row.public) expect(row.status, row.key).toBe("implemented_verified");
    expect(SEED.claims.find((row) => row.area === "sale_of_data")).toMatchObject({ status: "decision_required", public: false });
    expect(SEED.claims.find((row) => row.area === "messaging")).toMatchObject({ status: "implemented_unverified", public: false });
    // Every evidence file a verified claim names exists in this repository.
    for (const row of SEED.claims.filter((item) => item.status === "implemented_verified")) {
      for (const file of row.evidence.match(/convex\/[\w/.]+\.ts/g) ?? []) expect(() => readFileSync(path.join(process.cwd(), file)), `${row.key}: ${file}`).not.toThrow();
    }
  });

  it("shows the public only verified contacts, live providers and public verified claims, and never evidence", async () => {
    const { t, admin } = await staffSetup();
    // Before anything changes, the record and the website's fallback say the same.
    const first = await t.query(api.trust.publicSnapshot, {});
    expect({ ...first, updatedAt: 0 }).toEqual({ ...SEED_PUBLIC_SNAPSHOT, updatedAt: 0 });

    await admin.mutation(api.trust.updateSettings, { verified: { ...SEED.settings.verified, privacy: false, mailingAddress: false }, note: "Inbox not set up yet." });
    await admin.mutation(api.trust.upsertClaim, { ...claim, key: "draft-claim", status: "implemented_verified", public: false, evidence: "SECRET-EVIDENCE-TEXT", note: "Not public yet." });
    await admin.mutation(api.trust.setPublication, { documentId: "cookies-2026-11-16", status: "draft", note: "Back to draft." });

    const snapshot = await t.query(api.trust.publicSnapshot, {});
    expect(snapshot.settings).toEqual({
      legalEntity: "Divine Agency LLC",
      mailingAddress: null,
      governingPlace: "Maryland, United States",
      contacts: { security: "security@selestial.io", privacy: null, support: "support@selestial.io" },
      securityTxtExpiresOn: SEED.settings.securityTxtExpiresOn,
    });
    expect(snapshot.providers.map((row) => row.key).sort()).toEqual(["clerk", "convex", "resend", "vercel"]);
    expect(snapshot.claims.map((row) => row.key).sort()).toEqual(["access-company-members", "audit-append-only", "links-scoped", "permissions-per-action"]);
    expect(snapshot.publications.map((row) => row.documentId)).not.toContain("cookies-2026-11-16");
    const words = JSON.stringify(snapshot);
    for (const hidden of ["evidence", "SECRET-EVIDENCE-TEXT", "agreementRef", "reviewStatus", "Boss", "note", "test.ts", "decision_required"]) expect(words, hidden).not.toContain(hidden);
    // Anyone may read it, signed in or not.
    expect(await t.withIdentity(OUTSIDER).query(api.trust.publicSnapshot, {})).toEqual(snapshot);
  });

  it("refuses to make a claim public unless it is implemented and verified", async () => {
    const { admin, t } = await staffSetup();
    for (const status of ["implemented_unverified", "planned", "external_setup", "decision_required"] as const) {
      expect(await refusal(admin.mutation(api.trust.upsertClaim, { ...claim, status }))).toBe("A claim can be public only when it is implemented and verified.");
    }
    await admin.mutation(api.trust.upsertClaim, { ...claim, status: "planned", public: false });
    expect((await t.query(api.trust.publicSnapshot, {})).claims.map((row) => row.key)).not.toContain("links-scoped");
  });

  it("logs every change with what was public before and after, the author and the note", async () => {
    const { admin } = await staffSetup();
    const seeded = await admin.query(api.trust.changes, { limit: 200 });
    expect(seeded.every((row) => row.by.name === "seed" && row.action === "created")).toBe(true);

    await admin.mutation(api.trust.updateSettings, { contacts: { ...SEED.settings.contacts, privacy: "Privacy@Selestial.io " }, note: "Same inbox, typed again." });
    // Saving the same value (after tidying) changes nothing and logs nothing.
    expect((await admin.query(api.trust.changes, {})).length).toBe(Math.min(50, seeded.length));

    await admin.mutation(api.trust.updateSettings, { contacts: { ...SEED.settings.contacts, support: "help@selestial.io" }, note: "New support inbox." });
    await admin.mutation(api.trust.upsertClaim, { ...claim, evidence: "convex/linkAudit.test.ts and more", note: "Evidence and wording." });
    const provider = SEED.providers.find((row) => row.key === "resend")!;
    await admin.mutation(api.trust.upsertProvider, { ...provider, publicNote: provider.publicNote, status: "in_use", agreementRef: "Signed terms on file", note: "Email turned on." });
    await admin.mutation(api.trust.removeProvider, { key: "meta-pixel", note: "Not going ahead." });
    await admin.mutation(api.trust.setPublication, { documentId: "terms-2026-11-16", status: "withdrawn", note: "Replaced soon." });

    const [publication, removed, upserted, claimChange, settings] = await admin.query(api.trust.changes, { limit: 5 });
    expect(settings).toMatchObject({ table: "trustSettings", action: "updated", fields: [{ field: "contacts.support", before: "support@selestial.io", after: "help@selestial.io" }], internalFieldsChanged: [], by: { name: "Boss" }, note: "New support inbox." });
    expect(settings.by.staffId).toBeDefined();
    expect(claimChange).toMatchObject({ table: "trustClaims", key: "links-scoped", fields: [{ field: "text", after: claim.text }], internalFieldsChanged: ["evidence"] });
    // Staff-only values are named, never copied into the log.
    expect(JSON.stringify(claimChange)).not.toContain("and more");
    expect(upserted).toMatchObject({ table: "trustProviders", key: "resend", fields: [{ field: "status", before: "connected_not_live", after: "in_use" }], internalFieldsChanged: ["agreementRef"] });
    expect(JSON.stringify(upserted)).not.toContain("Signed terms");
    expect(removed).toMatchObject({ table: "trustProviders", key: "meta-pixel", action: "removed", note: "Not going ahead." });
    expect(removed.fields.find((row) => row.field === "name")).toEqual({ field: "name", before: "Meta Pixel", after: null });
    expect(publication).toMatchObject({ table: "policyPublications", key: "terms-2026-11-16", fields: [{ field: "status", before: "published", after: "withdrawn" }] });

    // Every write needs a note.
    expect(await refusal(admin.mutation(api.trust.removeProvider, { key: "google-ads", note: "  " }))).toBe("A note is required.");
  });

  it("checks what it is given: a real document, a date, an https address", async () => {
    const { admin } = await staffSetup();
    expect(await refusal(admin.mutation(api.trust.setPublication, { documentId: "terms-1999-01-01", status: "published", note: "x" }))).toBe("There is no document with that id.");
    expect(await refusal(admin.mutation(api.trust.updateSettings, { securityTxtExpiresOn: "2027-02-30", note: "x" }))).toContain("YYYY-MM-DD");
    const provider = { ...SEED.providers[0], note: "x" };
    expect(await refusal(admin.mutation(api.trust.upsertProvider, { ...provider, policyUrl: "javascript:alert(1)" }))).toContain("https://");
    expect(await refusal(admin.mutation(api.trust.removeProvider, { key: "nobody", note: "x" }))).toBe(NOT_FOUND);
  });

  it("lets only staff read it and only admins change it", async () => {
    const { t, reviewer, outsider } = await staffSetup();
    expect(await reviewer.query(api.trust.admin, {})).toMatchObject({ seeded: true, viewer: { role: "reviewer", canEdit: false } });
    const writes = [
      () => reviewer.mutation(api.trust.updateSettings, { governingPlace: "Elsewhere", note: "x" }),
      () => reviewer.mutation(api.trust.upsertClaim, claim),
      () => reviewer.mutation(api.trust.removeProvider, { key: "clerk", note: "x" }),
      () => reviewer.mutation(api.trust.upsertProvider, { ...SEED.providers[0], note: "x" }),
      () => reviewer.mutation(api.trust.setPublication, { documentId: "terms-2026-11-16", status: "draft", note: "x" }),
    ];
    for (const write of writes) expect(await refusal(write())).toBe(NOT_ALLOWED);
    for (const who of [outsider, t]) {
      expect(await refusal(who.query(api.trust.admin, {}))).toBe(NOT_FOUND);
      expect(await refusal(who.query(api.trust.changes, {}))).toBe(NOT_FOUND);
      expect(await refusal(who.mutation(api.trust.upsertClaim, claim))).toBe(NOT_FOUND);
    }
  });
});

describe("guards for the trust record", () => {
  it("allows a public read only in the reviewed file", () => {
    expect(publicQueryViolations([{ path: "convex/trust.ts", source: "export const x = publicQuery({ args: {}, handler: async () => 1 });" }])).toEqual([]);
    expect(publicQueryViolations([{ path: "convex/customers.ts", source: "export const x = publicQuery({ args: {}, handler: async () => 1 });" }])).not.toEqual([]);
  });

  it("keeps the trust change log append-only", () => {
    expect(trustChangeLogViolations([{ path: "convex/trust.ts", source: `await ctx.db.insert("trustChanges", {});` }])).not.toEqual([]);
    expect(trustChangeLogViolations([{ path: "convex/lib/trust/changes.ts", source: "await ctx.db.patch(id, {});" }])).not.toEqual([]);
  });
});
