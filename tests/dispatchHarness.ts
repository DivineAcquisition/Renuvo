/** Shared by the Dispatch scenario tests: cleaners with phones, the mock text service, and the texted links. */
import { vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mockOutbox } from "../convex/lib/messaging/provider";
import { company, dispatchCleaner, dispatchJob, dispatchPlace, HOUR, JOB_END, JOB_START, NOW, start, type T } from "./harness";

export type As = ReturnType<T["withIdentity"]>;

/** Runs everything that was scheduled (message sends and their follow-ups) without moving far in time. */
export async function flush(t: T) {
  for (let i = 0; i < 6; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

/** The link in the newest text to this number, as the cleaner would receive it. */
export function linkFor(phone: string, purpose: "offer" | "job", path = ""): string {
  const digits = phone.replace(/\D/g, "");
  const texts = mockOutbox.filter((row) => row.to.endsWith(digits) && row.result === "accepted");
  for (const text of texts.reverse()) {
    const match = text.body.match(new RegExp(`/c/${purpose}/([A-Za-z0-9_.-]+)${path}(?:\\s|$)`));
    if (match) return match[1];
  }
  throw new Error(`no ${purpose} link was texted to ${phone}`);
}

export const PHONES = { Lena: "+15550101010", Rosa: "+15550102020", Mia: "+15550103030", Noor: "+15550104040" } as const;

export async function setup(names: (keyof typeof PHONES)[] = ["Lena", "Rosa"], phones: Partial<Record<keyof typeof PHONES, string | null>> = {}) {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const place = await dispatchPlace(as, companyId);
  const cleaners = {} as Record<keyof typeof PHONES, Id<"cleaners">>;
  const phone = {} as Record<keyof typeof PHONES, string>;
  for (const name of names) {
    cleaners[name] = await dispatchCleaner(as, companyId, name);
    const number = phones[name] === undefined ? PHONES[name] : phones[name];
    if (number) await as.mutation(api.cleaners.update, { companyId, cleanerId: cleaners[name], phone: number });
    phone[name] = number ?? "";
  }
  const allow = (action: string, level: "off" | "propose" | "execute_and_report" | "execute" = "execute") => as.mutation(api.permissions.set, { companyId, action, level });
  /** The owner lets Dispatch offer, re-offer and cover without asking. */
  const autonomous = async () => {
    for (const action of ["dispatch.request_acceptance", "dispatch.send_replacement_offer", "dispatch.run_backup_coverage", "dispatch.send_reminder"]) await allow(action);
  };
  const job = (jobId: Id<"jobs">) => as.query(api.jobs.get, { companyId, jobId });
  const record = (jobId: Id<"jobs">) => as.query(api.dispatchViews.jobRecord, { companyId, jobId });
  const board = async (jobId: Id<"jobs">) => (await as.query(api.dispatchViews.board, { companyId, from: JOB_START - 24 * HOUR, to: JOB_END + 24 * HOUR })).jobs.find((row) => row.jobId === jobId)!;
  const tasks = (status: "open" | "waiting" | "needs_decision" | "done" | "cancelled", agent: "dispatch" | "recruiter" = "dispatch") => as.query(api.tasks.list, { companyId, status, agent });
  return { t, as, companyId, place, cleaners, phone, allow, autonomous, job, record, board, tasks };
}

/** A job taken to an accepted cleaner through the texted link, with the cleaner's job token. */
export async function accepted(s: Awaited<ReturnType<typeof setup>>, fields: Parameters<typeof dispatchJob>[3] & { requiredCrew?: number } = {}) {
  await s.autonomous();
  const jobId = await dispatchJob(s.as, s.companyId, s.place, fields);
  await flush(s.t);
  const offerToken = linkFor(s.phone.Lena, "offer");
  const answer = await s.t.mutation(api.links.acceptOffer, { token: offerToken });
  await flush(s.t);
  return { jobId, offerToken, jobToken: answer.jobToken!, assignmentId: (await s.job(jobId)).assignments.find((row) => row.status === "accepted")!._id };
}


/** Fake time, a link secret and the mock text service. Returns what to undo. */
export function dispatchTestEnv() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.ACTION_LINK_SECRET = "test-only-secret-for-action-links-0123456789";
  process.env.MESSAGING_PROVIDER = "mock";
  mockOutbox.length = 0;
  return () => {
    vi.useRealTimers();
    delete process.env.ACTION_LINK_SECRET;
    delete process.env.MESSAGING_PROVIDER;
  };
}
