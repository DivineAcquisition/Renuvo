/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it } from "vitest";

import { addMember, company, JOB_END, JOB_START, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { STALE } from "./settings";

const TUESDAY = 2;
const WEEKDAY_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 17 * 60 }));

const clean = {
  id: "standard-clean",
  name: "Standard clean",
  scope: "Kitchen, baths, floors and dusting",
  durationMinutes: 120,
  defaultCrew: 1,
  skills: ["Standard"],
  startingPriceCents: 15000,
  status: "active" as const,
};

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner", "Elm Cleaning");
  const manager = await addMember(t, as, companyId, "manager", "manager");
  const office = await addMember(t, as, companyId, "office", "office");
  const draft = (over: Record<string, unknown> = {}) => ({ companyId, expectedRevision: 0, name: "Elm Cleaning", timezone: "America/Chicago", serviceAreas: [], hours: [], services: [], ...over });
  const read = () => as.query(api.settings.business, { companyId });
  const save = (over: Record<string, unknown> = {}) => as.mutation(api.settings.saveBusiness, draft(over) as never);
  const events = (type: string) => t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((row) => row.type === type));
  const place = async (postalCode = "78701") => {
    const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home" });
    const propertyId = await as.mutation(api.properties.create, { companyId, customerId, kind: "home", address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode } });
    return { customerId, propertyId };
  };
  return { t, as, companyId, manager, office, draft, read, save, events, place };
}

describe("who may read and change business settings", () => {
  it("lets the Owner save, lets any member read, and refuses everyone else", async () => {
    const s = await setup();
    expect(await s.save({ serviceAreas: ["78701"] })).toEqual({ revision: 1, changed: true });
    for (const who of [s.as, s.manager, s.office]) expect(await who.query(api.settings.business, { companyId: s.companyId })).toMatchObject({ revision: 1, serviceAreas: ["78701"] });
    expect((await s.office.query(api.settings.business, { companyId: s.companyId })).canEdit).toBe(false);
    for (const who of [s.manager, s.office]) expect(await refusal(who.mutation(api.settings.saveBusiness, s.draft({ expectedRevision: 1 }) as never))).toBe(NOT_ALLOWED);
    expect(await refusal(s.t.query(api.settings.business, { companyId: s.companyId }))).not.toBe("");
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.settings.business, { companyId: s.companyId }))).toBe(NOT_FOUND);
    expect(await refusal(other.as.mutation(api.settings.saveBusiness, s.draft() as never))).toBe(NOT_FOUND);
    expect(await refusal(other.as.query(api.billing.planAndUsage, { companyId: s.companyId }))).toBe(NOT_FOUND);
  });

  it("stops a removed member at once", async () => {
    const s = await setup();
    const memberId = (await s.as.query(api.members.list, { companyId: s.companyId })).find((row) => row.email === "office@example.com")!.id;
    await s.as.mutation(api.members.remove, { companyId: s.companyId, memberId });
    expect(await refusal(s.office.query(api.settings.business, { companyId: s.companyId }))).toBe(NOT_FOUND);
    expect(await refusal(s.office.query(api.settings.connections, { companyId: s.companyId }))).toBe(NOT_FOUND);
  });
});

describe("saving", () => {
  it("refuses a stale draft instead of overwriting a newer save", async () => {
    const s = await setup();
    await s.save({ serviceAreas: ["78701"] });
    expect(await refusal(s.save({ expectedRevision: 0, serviceAreas: ["78702"] }))).toBe(STALE);
    expect((await s.read()).serviceAreas).toEqual(["78701"]);
    expect(await s.save({ expectedRevision: 1, serviceAreas: ["78702"] })).toMatchObject({ revision: 2 });
  });

  it("writes nothing when the normalized draft is unchanged", async () => {
    const s = await setup();
    // Nothing configured yet: an empty draft is not a save.
    expect(await s.save()).toEqual({ revision: 0, changed: false });
    expect((await s.read()).configured).toBe(false);
    await s.save({ serviceAreas: ["78702", "78701"], hours: WEEKDAY_HOURS, services: [clean] });
    expect(await s.events("company.business_settings_changed")).toHaveLength(1);
    // The same content spelled differently normalizes to what is saved.
    expect(await s.save({ expectedRevision: 1, serviceAreas: [" 78701 ", "78702-1234", "78701"], hours: [...WEEKDAY_HOURS].reverse(), services: [{ ...clean, name: "  Standard clean " }] })).toEqual({ revision: 1, changed: false });
    expect(await s.events("company.business_settings_changed")).toHaveLength(1);
    expect((await s.read()).revision).toBe(1);
  });

  it("validates the whole draft before writing any of it", async () => {
    const s = await setup();
    await s.save({ serviceAreas: ["78701"] });
    const bad = [
      { hours: [{ weekday: 1, startMinute: 600, endMinute: 540 }] },
      { hours: [{ weekday: 1, startMinute: 480, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 900 }] },
      { hours: [{ weekday: 9, startMinute: 0, endMinute: 60 }] },
      { serviceAreas: ["78701", "not a code!"] },
      { timezone: "Mars/Olympus" },
      { name: "   " },
      { services: [{ ...clean, durationMinutes: 5 }] },
      { services: [{ ...clean, defaultCrew: 0 }] },
      { services: [{ ...clean, startingPriceCents: -1 }] },
      { services: [{ ...clean, id: "Bad Id" }] },
      { services: [clean, { ...clean, id: "another-one" }] },
    ];
    for (const over of bad) {
      // Each draft also carries a valid rename. None of it may be kept.
      await expect(s.save({ expectedRevision: 1, name: "Renamed", ...over })).rejects.toThrow();
    }
    expect(await s.read()).toMatchObject({ revision: 1, name: "Elm Cleaning", timezone: "America/Chicago", serviceAreas: ["78701"], hours: [], services: [] });
    expect(await s.events("company.business_settings_changed")).toHaveLength(1);
  });

  it("keeps a saved service: it can be archived, not dropped", async () => {
    const s = await setup();
    await s.save({ services: [clean] });
    expect(await refusal(s.save({ expectedRevision: 1, services: [] }))).toMatch(/Archive it instead/);
    await s.save({ expectedRevision: 1, services: [{ ...clean, status: "archived" }] });
    expect((await s.read()).services[0].status).toBe("archived");
  });

  it("records who changed what, in the same step, and the plain company edit moves the revision too", async () => {
    const s = await setup();
    await s.save({ name: "Elm & Co", hours: WEEKDAY_HOURS });
    const [event] = await s.events("company.business_settings_changed");
    expect(event.data).toMatchObject({ sections: "name, hours", revision: 1 });
    await s.as.mutation(api.companies.update, { companyId: s.companyId, timezone: "America/New_York" });
    expect(await refusal(s.save({ expectedRevision: 1 }))).toBe(STALE);
  });
});

describe("operating area and hours", () => {
  it("enforces them for new visits and for rescheduling, and treats empty rules as no restriction", async () => {
    const s = await setup();
    const open = await s.place("90210");
    // Nothing configured: anywhere, any time.
    await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...open, serviceType: "standard", scope: "x", startsAt: JOB_START, endsAt: JOB_END });

    await s.save({ serviceAreas: ["78701"], hours: [{ weekday: TUESDAY, startMinute: 9 * 60, endMinute: 17 * 60 }] });
    const inside = await s.place("78701");
    const outside = await s.place("90210");
    const visit = (place: { customerId: Id<"customers">; propertyId: Id<"properties"> }, startsAt: number, endsAt: number) => s.as.mutation(api.jobs.create, { companyId: s.companyId, ...place, serviceType: "standard", scope: "x", startsAt, endsAt });

    // JOB_START is Tuesday 10:00 to 12:00 in Chicago.
    expect(await refusal(visit(outside, JOB_START, JOB_END))).toMatch(/does not work in 90210/);
    expect(await refusal(visit(inside, JOB_START - 2 * 3600_000, JOB_START))).toMatch(/operating hours/);
    expect(await refusal(visit(inside, JOB_START + 6 * 3600_000, JOB_START + 9 * 3600_000))).toMatch(/operating hours/);
    const jobId = await visit(inside, JOB_START, JOB_END);

    // Moving the visit is held to the same rules.
    expect(await refusal(s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, startsAt: JOB_START - 3 * 3600_000, endsAt: JOB_START - 3600_000 }))).toMatch(/operating hours/);
    await s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, startsAt: JOB_START + 3600_000, endsAt: JOB_END + 3600_000 });
    expect((await s.as.query(api.jobs.get, { companyId: s.companyId, jobId })).job.startsAt).toBe(JOB_START + 3600_000);
  });

  it("never moves or cancels a visit that was already booked when the rules were set", async () => {
    const s = await setup();
    const place = await s.place("90210");
    const jobId = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...place, serviceType: "standard", scope: "x", startsAt: JOB_START, endsAt: JOB_END });
    const before = await s.as.query(api.jobs.get, { companyId: s.companyId, jobId });
    await s.save({ serviceAreas: ["78701"], hours: [{ weekday: 1, startMinute: 480, endMinute: 600 }] });
    const after = await s.as.query(api.jobs.get, { companyId: s.companyId, jobId });
    expect(after.job).toEqual(before.job);
    expect(after.assignments).toEqual(before.assignments);
  });
});

describe("the service catalog", () => {
  it("makes visits from an active template, and keeps each visit's snapshot when the template changes", async () => {
    const s = await setup();
    await s.save({ services: [clean] });
    const place = await s.place();
    const jobId = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...place, serviceId: clean.id, startsAt: JOB_START, endsAt: JOB_END });
    const job = (await s.as.query(api.jobs.get, { companyId: s.companyId, jobId })).job;
    expect(job).toMatchObject({ serviceType: "Standard clean", scope: clean.scope, requiredSkills: ["standard"], priceCents: 15000, serviceSnapshot: { serviceId: clean.id, name: "Standard clean", durationMinutes: 120, startingPriceCents: 15000 } });

    await s.save({ expectedRevision: 1, services: [{ ...clean, name: "Basic clean", scope: "Changed", startingPriceCents: 20000, status: "archived" }] });
    const later = (await s.as.query(api.jobs.get, { companyId: s.companyId, jobId })).job;
    expect(later.serviceSnapshot).toEqual(job.serviceSnapshot);
    expect(later.priceCents).toBe(15000);
  });

  it("refuses an archived or unknown service for a new visit", async () => {
    const s = await setup();
    await s.save({ services: [{ ...clean, status: "archived" }] });
    const place = await s.place();
    const make = (serviceId: string) => s.as.mutation(api.jobs.create, { companyId: s.companyId, ...place, serviceId, startsAt: JOB_START, endsAt: JOB_END });
    expect(await refusal(make(clean.id))).toMatch(/archived/);
    expect(await refusal(make("nothing-here"))).toMatch(/not in the company's catalog/);
    // Without a template, the type and scope are still required.
    expect(await refusal(s.as.mutation(api.jobs.create, { companyId: s.companyId, ...place, startsAt: JOB_START, endsAt: JOB_END }))).toMatch(/Choose a service/);
  });
});

describe("connections", () => {
  it("separates test mode, configuration and what is unavailable, and returns no secret", async () => {
    const s = await setup();
    const saved = { ...process.env };
    try {
      process.env.EMAIL_PROVIDER = "mock";
      process.env.MESSAGING_PROVIDER = "telnyx";
      process.env.ACTION_LINK_SECRET = "a-secret-that-must-never-be-shown-0123456789";
      delete process.env.CALENDAR_PROVIDER;
      const result = await s.office.query(api.settings.connections, { companyId: s.companyId });
      const by = Object.fromEntries(result.connections.map((row) => [row.key, row.state]));
      expect(by).toMatchObject({ email: "test_mode", texting: "configured", action_links: "configured", calendar: "unavailable", signing: "unavailable", payments: "unavailable", billing: "unavailable", hiring_inbox: "not_configured" });
      expect(result.checkedLive).toBe(false);
      const body = JSON.stringify(result);
      expect(body).not.toContain("a-secret-that-must-never-be-shown");
      expect(body).not.toMatch(/healthy|working|connected to/i);
      delete process.env.EMAIL_PROVIDER;
      delete process.env.MESSAGING_PROVIDER;
      const bare = await s.as.query(api.settings.connections, { companyId: s.companyId });
      expect(Object.fromEntries(bare.connections.map((row) => [row.key, row.state]))).toMatchObject({ email: "not_configured", texting: "not_configured" });
    } finally {
      for (const key of ["EMAIL_PROVIDER", "MESSAGING_PROVIDER", "ACTION_LINK_SECRET", "CALENDAR_PROVIDER"]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

describe("the activity log", () => {
  it("pages through the company's own events with member names, for the Owner only", async () => {
    const s = await setup();
    for (let i = 0; i < 4; i += 1) await s.save({ expectedRevision: i, serviceAreas: [`7870${i}`] });
    const first = await s.as.query(api.settings.activity, { companyId: s.companyId, paginationOpts: { numItems: 3, cursor: null } });
    expect(first.page).toHaveLength(3);
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toMatchObject({ actor: "owner", type: "company.business_settings_changed" });
    expect(first.page[0].text).toMatch(/changed business settings/);
    const seen = new Set(first.page.map((row) => row.id));
    let cursor: string | null = first.continueCursor;
    let more = first.isDone;
    while (!more) {
      const next: typeof first = await s.as.query(api.settings.activity, { companyId: s.companyId, paginationOpts: { numItems: 3, cursor } });
      for (const row of next.page) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = next.continueCursor;
      more = next.isDone;
    }
    expect(seen.size).toBeGreaterThan(5);
    // Another company's people never appear, and nothing carries a message body.
    const other = await company(s.t, "owner-b", "Beta");
    const theirs = await other.as.query(api.settings.activity, { companyId: other.companyId, paginationOpts: { numItems: 50, cursor: null } });
    expect(theirs.page.every((row) => row.actor === "owner-b" || row.actor === "Selestial")).toBe(true);
    for (const who of [s.manager, s.office]) expect(await refusal(who.query(api.settings.activity, { companyId: s.companyId, paginationOpts: { numItems: 3, cursor: null } }))).toBe(NOT_ALLOWED);
    expect(Object.keys(first.page[0]).sort()).toEqual(["actor", "actorKind", "at", "described", "id", "text", "type"]);
  });
});

describe("people", () => {
  it("lets the Owner change a role or remove access, but not touch the Owner", async () => {
    const s = await setup();
    const members = await s.as.query(api.members.list, { companyId: s.companyId });
    const ownerId = members.find((row) => row.role === "owner")!.id;
    const officeId = members.find((row) => row.role === "office")!.id;
    await s.as.mutation(api.members.setRole, { companyId: s.companyId, memberId: officeId, role: "manager" });
    expect((await s.as.query(api.members.list, { companyId: s.companyId })).find((row) => row.id === officeId)?.role).toBe("manager");
    expect(await refusal(s.as.mutation(api.members.setRole, { companyId: s.companyId, memberId: ownerId, role: "office" }))).toMatch(/Owner/);
    expect(await refusal(s.as.mutation(api.members.remove, { companyId: s.companyId, memberId: ownerId }))).toMatch(/Owner/);
    expect(await refusal(s.manager.mutation(api.members.remove, { companyId: s.companyId, memberId: officeId }))).toBe(NOT_ALLOWED);
  });
});

describe("recruiting rules", () => {
  it("refuses invalid ranges, duplicate reminders and an empty requirement set", async () => {
    const s = await setup();
    const set = (settings: Record<string, unknown>) => s.as.mutation(api.recruiter.updatePlaybook, { companyId: s.companyId, settings: settings as never });
    expect(await refusal(set({ sendFromMinute: 18 * 60, sendUntilMinute: 9 * 60 }))).toMatch(/end after they start/);
    expect(await refusal(set({ followUpHours: [48, 48] }))).toMatch(/same time/);
    expect(await refusal(set({ followUpHours: [48], maxFollowUps: 3 }))).toMatch(/no more than/);
    expect(await refusal(set({ onboardingRequirements: [] }))).toMatch(/at least one/);
    expect(await refusal(set({ onboardingRequirements: [{ key: "a", label: "A" }, { key: "a", label: "B" }] }))).toMatch(/share a key/);
    expect(await refusal(set({ sendDays: [] }))).toMatch(/at least one day/);
    expect(await refusal(set({ retentionDays: 5 }))).toMatch(/between/);
    await set({ followUpHours: [24, 72], maxFollowUps: 2, sendFromMinute: 540, sendUntilMinute: 1080, onboardingRequirements: [{ key: "agreement", label: "Agreement completed" }] });
    const playbook = await s.as.query(api.recruiter.playbook, { companyId: s.companyId });
    expect(playbook.settings).toMatchObject({ followUpHours: [24, 72], onboardingRequirements: [{ key: "agreement", label: "Agreement completed" }] });
  });
});
