/** Shared by the Convex tests. Kept outside convex/ so it is never bundled into a deployment. */
import { convexTest } from "convex-test";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob(["../convex/**/*.ts", "!../convex/**/*.test.ts"]);

export function start() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof start>;

/** A signed-in person, as the session token will describe them once Clerk is connected. */
export function person(subject: string, extra: Record<string, string | boolean> = {}) {
  const email = `${subject}@example.com`;
  return {
    subject,
    email,
    emailVerified: true,
    name: subject,
    issuer: "https://clerk.selestial.test",
    tokenIdentifier: `https://clerk.selestial.test|${subject}`,
    ...extra,
  };
}

/** The words a refused call carries. A message meant for a person travels as ConvexError data. */
export async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const data = (error as { data?: { message?: unknown } }).data;
    if (data && typeof data.message === "string") return data.message;
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal");
}

export async function company(t: T, subject: string, name: string) {
  const as = t.withIdentity(person(subject));
  const companyId = await as.mutation(api.companies.create, { name, timezone: "America/Chicago" });
  return { as, companyId };
}

/**
 * A messaging setup that can text: a sender name, a texting number and an approved registration. In the
 * product only Selestial staff can mark a registration approved, so tests write it directly. Each
 * company gets its own number, since inbound texts find the company by it.
 */
export async function readyMessaging(t: T, companyId: Id<"companies">, senderName = "Test Cleaning") {
  return t.run(async (ctx) => {
    const count = (await ctx.db.query("complianceProfiles").collect()).length;
    const smsNumber = `+1512555${String(1000 + count).padStart(4, "0")}`;
    const now = Date.now();
    await ctx.db.insert("complianceProfiles", {
      companyId,
      identity: {},
      messaging: {
        senderName,
        smsNumber,
        registration: { status: "approved", updatedAt: now, updatedBy: "staff" },
        quietHours: { start: "21:00", end: "08:00", appliesToOperational: false },
        frequency: { marketingPerWeek: 2, recruitingPerWeek: 7 },
      },
      updatedAt: now,
    });
    return smsNumber;
  });
}

/** A cleaner's permission for work texts, as their onboarding form would give it. */
export async function workTextsAllowed(as: ReturnType<T["withIdentity"]>, companyId: Id<"companies">, cleanerId: Id<"cleaners">) {
  await as.mutation(api.consent.record, {
    companyId,
    recipient: { kind: "cleaner", id: cleanerId },
    channel: "sms",
    category: "operational",
    status: "granted",
    source: "onboarding",
    evidence: "Signed onboarding form.",
  });
}

/** A link secret for tests. It is not a real one: nothing outside the test run is signed with it. */
export const TEST_LINK_SECRET = "test-only-secret-for-action-links-0123456789";

/** Runs `work` with a link secret set, and puts the setting back as it was. Inviting needs one. */
export async function withLinkSecret<R>(work: () => Promise<R>): Promise<R> {
  const before = process.env.ACTION_LINK_SECRET;
  if (!before) process.env.ACTION_LINK_SECRET = TEST_LINK_SECRET;
  try {
    return await work();
  } finally {
    if (!before) delete process.env.ACTION_LINK_SECRET;
  }
}

/** Adds a person to a company the way the product does: the Owner invites, the person joins. */
export async function addMember(t: T, owner: ReturnType<T["withIdentity"]>, companyId: Id<"companies">, subject: string, role: "manager" | "office") {
  await withLinkSecret(() => owner.mutation(api.invitations.create, { companyId, email: `${subject}@example.com`, name: subject, role }));
  const as = t.withIdentity(person(subject));
  await as.mutation(api.members.join, { companyId });
  return as;
}

// Tuesday March 2, 2027, 10:00 to 12:00 in Chicago (UTC-6 on that date).
export const TUESDAY = 2;
export const JOB_START = Date.UTC(2027, 2, 2, 16, 0);
export const JOB_END = Date.UTC(2027, 2, 2, 18, 0);
/** "Now" in the tests: the day before, at noon UTC. */
export const NOW = Date.UTC(2027, 2, 1, 12, 0);
export const HOUR = 60 * 60 * 1000;

/** A customer with a property, a ready cleaner who works Tuesdays 8:00 to 17:00, and a scheduled job. */
export async function seedVisit(as: ReturnType<T["withIdentity"]>, companyId: Id<"companies">) {
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home" });
  const propertyId = await as.mutation(api.properties.create, {
    companyId,
    customerId,
    kind: "home",
    address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" },
  });
  const cleanerId = await readyCleaner(as, companyId, "Rosa");
  const jobId = await as.mutation(api.jobs.create, {
    companyId,
    customerId,
    propertyId,
    serviceType: "standard",
    scope: "3 bed, 2 bath standard clean",
    startsAt: JOB_START,
    endsAt: JOB_END,
  });
  return { customerId, propertyId, cleanerId, jobId };
}

export async function readyCleaner(as: ReturnType<T["withIdentity"]>, companyId: Id<"companies">, name: string, skills: string[] = []) {
  const cleanerId = await as.mutation(api.cleaners.create, { companyId, name, engagement: "contractor", skills });
  await as.mutation(api.cleaners.setStatus, { companyId, cleanerId, status: "ready" });
  await as.mutation(api.availability.setWeek, { companyId, cleanerId, windows: [{ weekday: TUESDAY, startMinute: 8 * 60, endMinute: 17 * 60 }] });
  return cleanerId;
}

// ── Dispatch ────────────────────────────────────────────────────────────────────────────────────

export const AREA = "78701";
/** The price of the seeded visit: $160.00. */
export const PRICE = 16000;

/**
 * A cleaner Dispatch can ask: ready, works Tuesdays 8:00 to 17:00 in the seeded area, and paid half of
 * the job unless `shareBps` says otherwise (null leaves pay unset).
 */
export async function dispatchCleaner(
  as: ReturnType<T["withIdentity"]>,
  companyId: Id<"companies">,
  name: string,
  options: { skills?: string[]; areas?: string[]; shareBps?: number | null; hourlyCents?: number } = {},
) {
  const employee = options.hourlyCents !== undefined;
  const cleanerId = await as.mutation(api.cleaners.create, {
    companyId,
    name,
    engagement: employee ? "employee" : "contractor",
    skills: options.skills ?? [],
    serviceAreas: options.areas ?? [AREA],
  });
  await as.mutation(api.cleaners.setStatus, { companyId, cleanerId, status: "ready" });
  await as.mutation(api.availability.setWeek, { companyId, cleanerId, windows: [{ weekday: TUESDAY, startMinute: 8 * 60, endMinute: 17 * 60 }] });
  await workTextsAllowed(as, companyId, cleanerId);
  if (employee) await as.mutation(api.cleaners.setPay, { companyId, cleanerId, pay: { kind: "hourly", hourlyCents: options.hourlyCents! } });
  else if (options.shareBps !== null) await as.mutation(api.cleaners.setPay, { companyId, cleanerId, pay: { kind: "share", shareBps: options.shareBps ?? 5000 } });
  return cleanerId;
}

/** A customer and their home in the seeded area. */
export async function dispatchPlace(as: ReturnType<T["withIdentity"]>, companyId: Id<"companies">) {
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home" });
  const propertyId = await as.mutation(api.properties.create, {
    companyId,
    customerId,
    kind: "home",
    address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: AREA },
  });
  return { customerId, propertyId };
}

/** A priced visit on the seeded Tuesday. Creating it is what first sets Dispatch to work on it. */
export async function dispatchJob(
  as: ReturnType<T["withIdentity"]>,
  companyId: Id<"companies">,
  place: { customerId: Id<"customers">; propertyId: Id<"properties"> },
  fields: { startsAt?: number; endsAt?: number; priceCents?: number | null; requiredSkills?: string[] } = {},
) {
  return as.mutation(api.jobs.create, {
    companyId,
    ...place,
    serviceType: "standard",
    scope: "3 bed, 2 bath standard clean",
    startsAt: fields.startsAt ?? JOB_START,
    endsAt: fields.endsAt ?? JOB_END,
    requiredSkills: fields.requiredSkills,
    ...(fields.priceCents === null ? {} : { priceCents: fields.priceCents ?? PRICE }),
  });
}

/** A Selestial staff admin holding these granted capabilities (convex/lib/support/catalog.ts), as an admin would grant them. */
export async function staffWith(t: T, identity: { subject: string; email: string; name: string }, capabilities: ("billing.adjust" | "communications.send" | "records.destroy" | "outbound.suspend")[]) {
  await t.run((ctx) => ctx.db.insert("staff", { userId: identity.subject, email: identity.email.toLowerCase(), name: identity.name, role: "admin", status: "active", addedAt: Date.now(), addedBy: "console", capabilities }));
}
