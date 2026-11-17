/**
 * Writing worker records. Every change here is made by a person (brief, section 5): no agent adds a
 * worker, changes their standing or their relationship type, and there is no function through which one could.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { WeeklyWindow } from "../availability";
import { notFound, userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import type { CleanerStatus } from "../statuses";
import { revokePortal } from "./portal";
import { optionalEmail, optionalText, tags, text } from "../text";

export type Engagement = Doc<"cleaners">["engagement"];

export function checkWindows(windows: WeeklyWindow[]): WeeklyWindow[] {
  if (windows.length > 50) throw userError("That is too many windows for one week.");
  for (const window of windows) {
    const whole = [window.weekday, window.startMinute, window.endMinute].every(Number.isInteger);
    if (!whole || window.weekday < 0 || window.weekday > 6 || window.startMinute < 0 || window.endMinute > 24 * 60 || window.startMinute >= window.endMinute) {
      throw userError("Each window needs a day of the week and a start time before its end time.");
    }
  }
  return windows;
}

export const areas = (values: string[]) => tags(values, "Service areas", 200).map((code) => code.toUpperCase());
export const skills = (values: string[]) => tags(values, "Skills");

export function phone(value: string | undefined): string | undefined {
  const cleaned = optionalText(value, "Phone", 40);
  if (cleaned === undefined) return undefined;
  const digits = cleaned.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) throw userError("The phone number needs 10 to 15 digits.");
  return cleaned;
}

/** A subcontractor that may supply a worker now. A paused or ended company takes no new workers. */
export async function activeSubcontractor(ctx: MutationCtx, companyId: Id<"companies">, id: Id<"subcontractors">): Promise<Doc<"subcontractors">> {
  const row = await ctx.db.get(id);
  if (!row || row.companyId !== companyId) notFound();
  if (row.status !== "active") throw userError(`${row.name} is ${row.status}, so no worker can be added through them.`);
  return row;
}

/** Relationship type and supplying company must agree: a subcontracted worker has one, a direct worker has none. */
export function checkAffiliation(engagement: Engagement, subcontractorId: Id<"subcontractors"> | undefined) {
  if (engagement === "subcontracted" && !subcontractorId) throw userError("Choose the subcontractor company that supplies this worker.");
  if (engagement !== "subcontracted" && subcontractorId) throw userError("Only a subcontractor worker is supplied by a subcontractor company.");
}

export type NewWorker = {
  name: string;
  preferredName?: string;
  engagement: Engagement;
  email?: string;
  phone?: string;
  skills?: string[];
  serviceAreas?: string[];
  subcontractorId?: Id<"subcontractors">;
  windows?: WeeklyWindow[];
  source: "manual" | "import";
  addKey?: string;
};

/** Adds one worker in "onboarding". Nobody is offered work until a person marks them active. */
export async function insertWorker(ctx: MutationCtx, companyId: Id<"companies">, input: NewWorker, member: Doc<"members">, extra: Record<string, string | number | boolean | null> = {}): Promise<Id<"cleaners">> {
  checkAffiliation(input.engagement, input.subcontractorId);
  const windows = checkWindows(input.windows ?? []);
  const subcontractor = input.subcontractorId ? await activeSubcontractor(ctx, companyId, input.subcontractorId) : null;
  const now = Date.now();
  const cleanerId = await ctx.db.insert("cleaners", {
    companyId,
    name: text(input.name, "Name", 160),
    preferredName: optionalText(input.preferredName, "Preferred name", 80),
    engagement: input.engagement,
    email: optionalEmail(input.email),
    phone: phone(input.phone),
    status: "onboarding",
    skills: skills(input.skills ?? []),
    serviceAreas: areas(input.serviceAreas ?? []),
    source: input.source,
    addKey: input.addKey,
    createdAt: now,
  });
  for (const window of windows) await ctx.db.insert("availabilityWindows", { companyId, cleanerId, ...window });
  const actor: Actor = { kind: "member", memberId: member._id };
  await recordEvent(ctx, { companyId, type: "cleaner.created", actor, subject: { table: "cleaners", id: cleanerId }, data: { source: input.source, ...extra } });
  if (subcontractor) {
    await ctx.db.insert("workerAffiliations", { companyId, cleanerId, subcontractorId: subcontractor._id, startedAt: now, by: member._id });
    await recordEvent(ctx, { companyId, type: "cleaner.affiliation_changed", actor, subject: { table: "cleaners", id: cleanerId }, data: { subcontractorId: subcontractor._id } });
  }
  return cleanerId;
}

/**
 * A person changes a worker's engagement status. Pausing or ending needs a reason, which is kept on the
 * worker for managers to read. Nothing here takes the worker off a visit they accepted: those stay, and
 * the Cleaners workspace lists them so a person decides each one.
 */
export async function changeStatus(ctx: MutationCtx, cleaner: Doc<"cleaners">, to: CleanerStatus, reason: string | undefined, member: Doc<"members">): Promise<boolean> {
  if (cleaner.status === to) return false;
  const why = optionalText(reason, "The reason", 500);
  if ((to === "paused" || to === "ended") && (!why || why.length < 3)) throw userError(to === "paused" ? "Say why they are being paused." : "Say why the engagement is ending.");
  if (to === "onboarding" && cleaner.status !== "onboarding") throw userError("A worker who has started cannot go back to onboarding. Pause them instead.");
  await ctx.db.patch(cleaner._id, { status: to, statusNote: why, statusChangedAt: Date.now(), statusChangedBy: member._id });
  // Ending an engagement closes the cleaner's portal. Their history, documents and jobs are kept.
  if (to === "ended") await revokePortal(ctx, cleaner, "Their engagement ended.", { kind: "member", memberId: member._id });
  await recordEvent(ctx, {
    companyId: cleaner.companyId,
    type: "cleaner.status_changed",
    actor: { kind: "member", memberId: member._id },
    subject: { table: "cleaners", id: cleaner._id },
    data: { from: cleaner.status, to, reasonGiven: Boolean(why) },
  });
  return true;
}

/** Moves a worker to another supplying company, or to none. The open affiliation is closed, never removed. */
export async function setAffiliation(ctx: MutationCtx, cleaner: Doc<"cleaners">, subcontractorId: Id<"subcontractors"> | null, member: Doc<"members">): Promise<void> {
  const open = (
    await ctx.db
      .query("workerAffiliations")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", cleaner.companyId).eq("cleanerId", cleaner._id))
      .take(100)
  ).filter((row) => row.endedAt === undefined);
  if (subcontractorId && open.some((row) => row.subcontractorId === subcontractorId)) return;
  const now = Date.now();
  if (subcontractorId) await activeSubcontractor(ctx, cleaner.companyId, subcontractorId);
  for (const row of open) await ctx.db.patch(row._id, { endedAt: now });
  if (subcontractorId) await ctx.db.insert("workerAffiliations", { companyId: cleaner.companyId, cleanerId: cleaner._id, subcontractorId, startedAt: now, by: member._id });
  await recordEvent(ctx, { companyId: cleaner.companyId, type: "cleaner.affiliation_changed", actor: { kind: "member", memberId: member._id }, subject: { table: "cleaners", id: cleaner._id }, data: { subcontractorId: subcontractorId ?? null } });
}

/** Reads a worker type as people write it in a spreadsheet. Null when it cannot be read: the import says so instead of guessing. */
export function parseEngagement(value: string | undefined): Engagement | null {
  const word = value?.trim().toLowerCase().replace(/[^a-z0-9 ]/g, " ") ?? "";
  if (!word) return null;
  if (/\bsub ?contract/.test(word)) return "subcontracted";
  if (/\b(employee|w ?2|hourly|staff)\b/.test(word)) return "employee";
  if (/\b(contractor|1099|independent|ic)\b/.test(word)) return "contractor";
  return null;
}
