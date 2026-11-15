/**
 * Dispatch's work on one visit, as the steps it actually took. Every step is read from the record:
 * the cleaners it checked, who it chose and why, what the owner's permission allowed, the offers and
 * the answers. Nothing here is narrated by a model, and a step that has not happened says so.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { authorityFor } from "../authority";
import { liveTaskByKey } from "../taskState";
import { when } from "../time";
import { candidatesFor, coverAction, coverKey, jobApprovals } from "./workflow";

/**
 * done: happened. waiting: on someone outside. needs_you: on the owner. blocked: cannot go on.
 * todo: not reached yet.
 */
export type RunStep = { key: "read" | "check" | "choose" | "permission" | "ask" | "accept"; label: string; state: "done" | "waiting" | "needs_you" | "blocked" | "todo"; detail: string };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export async function coverRun(ctx: QueryCtx, company: Doc<"companies">, job: Doc<"jobs">, asOf: number): Promise<RunStep[]> {
  if (job.status === "cancelled") return [];
  const tz = company.timezone;
  const found = await candidatesFor(ctx, company, job);
  const name = async (row: Doc<"assignments">) => found.cleaners.find((cleaner) => cleaner._id === row.cleanerId)?.name ?? (await ctx.db.get(row.cleanerId))?.name ?? "A cleaner";
  const accepted = found.assignments.find((row) => row.status === "accepted");
  const offered = found.assignments.filter((row) => row.status === "offered").sort((a, b) => a.respondBy - b.respondBy)[0];
  const ended = found.assignments.filter((row) => row.status === "declined" || row.status === "expired" || (row.status === "cancelled" && row.endCause === "released"));
  const steps: RunStep[] = [{ key: "read", label: "Read the visit", state: "done", detail: `${job.serviceType}, ${when(job.startsAt, asOf, tz)}${job.requiredSkills.length > 0 ? `; needs ${job.requiredSkills.join(", ")}` : ""}.` }];

  const earlier = ended.length > 0 ? ` ${plural(ended.length, "earlier offer")} ended without an acceptance.` : "";
  if (accepted || job.status !== "scheduled") {
    const who = accepted ? await name(accepted) : null;
    steps.push({ key: "ask", label: "Requested acceptance", state: "done", detail: who ? `${who} was asked.${earlier}` : `The visit went ahead.${earlier}` });
    steps.push({ key: "accept", label: "Accepted", state: who ? "done" : "todo", detail: who ? `${who} accepted. The visit is covered.` : "No acceptance is on record for this visit." });
    return steps;
  }

  const total = found.candidates.length + found.excluded.length;
  const top = found.candidates[0];
  const task = await liveTaskByKey(ctx, company._id, coverKey(job._id));
  const pending = (await jobApprovals(ctx, job)).find((row) => row.status === "pending");
  const authority = await authorityFor(ctx, company._id, coverAction(found.assignments));
  const withPerson = task?.withPersonSince !== undefined;

  steps.push(
    total === 0
      ? { key: "check", label: "Checked every ready cleaner", state: "blocked", detail: "No cleaner is marked ready for work." }
      : { key: "check", label: "Checked every ready cleaner", state: "done", detail: `${found.candidates.length} can take it, ${found.excluded.length} cannot.` },
  );

  let stopped = total === 0;
  if (offered) {
    steps.push({ key: "choose", label: "Chose who to ask", state: "done", detail: `${await name(offered)}.` });
  } else if (top) {
    steps.push({ key: "choose", label: "Chose who to ask", state: "done", detail: `${top.name} first: ${top.name} ${top.reasons[0] ?? "can take it"}` });
  } else {
    const why = found.excluded.slice(0, 2).map((entry) => `${entry.name} ${entry.reason}`);
    steps.push({ key: "choose", label: "Chose who to ask", state: stopped ? "todo" : "blocked", detail: stopped ? "Nobody to choose from yet." : `Nobody can be asked. ${why.join(" ")}`.trim() });
    stopped = true;
  }

  let permission: RunStep;
  if (stopped) permission = { key: "permission", label: "Checked what you allow", state: "todo", detail: "Not reached." };
  else if (withPerson) permission = { key: "permission", label: "Checked what you allow", state: "needs_you", detail: "You are handling this visit. Dispatch leaves it alone until you hand it back." };
  else if (authority.kind === "paused") permission = { key: "permission", label: "Checked what you allow", state: "blocked", detail: "Dispatch is paused, so nothing goes out." };
  else if (authority.kind !== "level" || authority.level === "off") permission = { key: "permission", label: "Checked what you allow", state: "needs_you", detail: "Switched off for Dispatch. A person offers this visit." };
  else if (offered) permission = { key: "permission", label: "Checked what you allow", state: "done", detail: "The offer was allowed to go out." };
  else if (authority.level === "propose") {
    permission = pending
      ? { key: "permission", label: "Checked what you allow", state: "needs_you", detail: `On Propose: waiting for your approval, due ${when(pending.decideBy, asOf, tz)}.` }
      : { key: "permission", label: "Checked what you allow", state: "needs_you", detail: "On Propose: a person decides before any offer goes out." };
  } else {
    permission = { key: "permission", label: "Checked what you allow", state: "done", detail: authority.level === "execute_and_report" ? "Allowed to send the offer and report it." : "Allowed to send the offer." };
  }
  steps.push(permission);
  if (permission.state !== "done") stopped = true;

  steps.push(
    offered
      ? { key: "ask", label: "Requested acceptance", state: "waiting", detail: `Offer out to ${await name(offered)}; answer due ${when(offered.respondBy, asOf, tz)}.${earlier}` }
      : { key: "ask", label: "Requested acceptance", state: "todo", detail: `No offer is out.${earlier}` },
  );
  steps.push({ key: "accept", label: "Accepted", state: "todo", detail: "Not yet. The visit is not covered until a cleaner accepts." });
  return steps;
}
