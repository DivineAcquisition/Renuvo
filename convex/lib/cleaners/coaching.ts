/**
 * Selestial's coaching drafts: written from the records a suggestion rests on, kept as a draft that nobody
 * but the office sees until a person publishes it. The profile and Chat both make drafts through this.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { performanceFor, recommendationsFor, PERIOD_DAYS, SCORE_VERSION } from "./performance";

export type DraftKey = "late" | "no_show" | "recognize" | "unanswered";
export const DRAFT_KEYS: DraftKey[] = ["late", "no_show", "recognize", "unanswered"];

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Makes the draft, or finds the one already waiting. Refuses when the records no longer show the reason. */
export async function draftCoaching(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, key: DraftKey | null, actor: Actor): Promise<{ noteId: Id<"coachingNotes">; already: boolean; title: string }> {
  if (cleaner.status === "ended") throw userError("This engagement has ended.");
  const performance = await performanceFor(ctx, company, cleaner._id, Date.now());
  const recs = recommendationsFor(performance).filter((row) => (DRAFT_KEYS as string[]).includes(row.key));
  const rec = key ? recs.find((row) => row.key === key) : (recs.find((row) => row.kind === "coach") ?? recs[0]);
  if (!rec) throw userError(key ? "The records no longer show this, so there is nothing to draft." : `Nothing in ${first(cleaner.name)}'s records over the last ${PERIOD_DAYS} days calls for a coaching note.`);
  const draft = draftText(rec.key as DraftKey, cleaner, rec.evidence.map((row) => row.label), performance.measures.reliability.denominator);
  const open = (
    await ctx.db
      .query("coachingNotes")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(100)
  ).find((row) => row.author.kind === "selestial" && (row.status === "draft" || row.status === "awaiting_review") && row.title === draft.title);
  if (open) return { noteId: open._id, already: true, title: open.title };
  const now = Date.now();
  const noteId = await ctx.db.insert("coachingNotes", {
    companyId: company._id,
    cleanerId: cleaner._id,
    kind: draft.kind,
    visibility: draft.visibility,
    status: "draft",
    title: draft.title,
    body: draft.body,
    evidence: rec.evidence.map((row) => ({ kind: "job" as const, id: row.jobId, label: row.label })),
    actions: draft.actions.map((item) => ({ text: item })),
    followUpAt: draft.followUpDays ? now + draft.followUpDays * 86_400_000 : undefined,
    author: { kind: "selestial", scoreVersion: SCORE_VERSION },
    createdAt: now,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: company._id, type: "cleaner.coaching_drafted", actor, subject: { table: "cleaners", id: cleaner._id }, data: { noteId, key: rec.key } });
  return { noteId, already: false, title: draft.title };
}

function draftText(key: DraftKey, cleaner: Doc<"cleaners">, jobs: string[], acceptedJobs: number) {
  const name = first(cleaner.name);
  const list = jobs.map((label) => `• ${label}`).join("\n");
  switch (key) {
    case "late":
      return {
        kind: "coaching" as const,
        visibility: "shared" as const,
        title: "Arriving on time",
        body: `Hi ${name}, we wanted to check in about arrival times. On these jobs the check-in was after the arrival window, without a message beforehand:\n${list}\n\nIf something makes it hard to arrive on time (travel, the schedule, the job before), tell us and we will look at it together. If you are running late, a quick message from the job link helps the customer and us. If you arrived on time and only checked in late, tell us and we will correct the record.`,
        actions: ["Send a message from the job link when running late", "Tell the office if a schedule makes arriving on time hard"],
        followUpDays: 30,
      };
    case "no_show":
      return {
        kind: "feedback" as const,
        visibility: "shared" as const,
        title: "A job recorded as missed",
        body: `Hi ${name}, we have this job recorded as a no-show:\n${list}\n\nBefore anything else we would like to hear what happened. If the record is wrong, tell us and we will correct it.`,
        actions: ["Tell us what happened"],
        followUpDays: 7,
      };
    case "recognize":
      return {
        kind: "feedback" as const,
        visibility: "shared" as const,
        title: "Thank you",
        body: `Hi ${name}, you kept every one of the ${acceptedJobs} jobs you accepted over the last ${PERIOD_DAYS} days. Customers and the team notice. Thank you.`,
        actions: [],
        followUpDays: 0,
      };
    case "unanswered":
      return {
        kind: "note" as const,
        visibility: "internal" as const,
        title: "Offers going unanswered",
        body: `These offers closed without an answer:\n${list}\n\nCheck that their mobile number is right and that texts reach them before reading anything into it.`,
        actions: ["Check their contact details", "Ask how they prefer to get offers"],
        followUpDays: 14,
      };
  }
}

