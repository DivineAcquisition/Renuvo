/**
 * Booking Experiences through Company Chat. The model is the scripted mock, so what is checked is the
 * tools: they edit the same draft the builder shows, through the same revision check, never publish,
 * never touch prices or payment rules, and say what changed and what still blocks publishing.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, start, type T } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockChat } from "./lib/chat/model";
import { blankSpec, type Spec } from "./lib/services/spec";

let keys = 0;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const notice = { required: false, note: "" };

function spec(name: string, patch: Partial<Spec> = {}): Spec {
  return {
    ...blankSpec("residential"),
    name,
    summary: `${name} for homes.`,
    included: [
      { id: "counters", label: "Wipe counters", section: "Kitchen", requiresPhoto: false },
      { id: "floors", label: "Mop floors", section: "Living areas", requiresPhoto: false },
    ],
    excluded: [],
    pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1000, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 },
    team: { crewSize: 1, maxCrew: 3, maxVisitMinutes: 360, skills: [], arrivalWindowMinutes: 60 },
    ...patch,
  };
}

async function setup() {
  const t = start();
  const owner = await company(t, "owner", "Elm Cleaning");
  await t.run(async (ctx) => ctx.db.patch(owner.companyId, { plan: "operate" }));
  for (const s of [spec("Standard clean"), spec("Deep clean", { included: [...spec("x").included, { id: "base", label: "Baseboards", section: "Living areas", requiresPhoto: false }] })]) {
    const { serviceId } = await owner.as.mutation(api.services.startDraft, { companyId: owner.companyId, category: s.category, spec: s, origin: "manual" });
    const { changeId } = await owner.as.mutation(api.services.submit, { companyId: owner.companyId, serviceId, expectedRevision: 1, reason: "Launch.", customerNotice: notice, contractReview: notice });
    const change = await owner.as.query(api.services.change, { companyId: owner.companyId, changeId });
    await owner.as.mutation(api.services.approve, { companyId: owner.companyId, changeId, hash: change.hash, publish: true });
  }
  const manager = await addMember(t, owner.as, owner.companyId, "manager", "manager");
  const office = await addMember(t, owner.as, owner.companyId, "office", "office");
  return { t, ...owner, manager, office };
}
type S = Awaited<ReturnType<typeof setup>>;
type As = S["as"];

async function ask(s: S, who: As, text: string) {
  await who.mutation(api.chat.send, { companyId: s.companyId, text, clientKey: `k-${(keys += 1)}` });
  await settle(s.t);
}
const resultsOf = async (s: S, tool: string) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query("chatActionSteps").collect())
      .filter((row) => row.tool === tool)
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((row) => ({ status: row.status, summary: row.summary ?? null, data: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : null })),
  );

describe("Booking Experiences in Company Chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.CHAT_MODEL = "mock";
    mockChat.script = [];
    mockChat.seen = [];
    mockChat.onRespond = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CHAT_MODEL;
  });

  it("creates a draft from published services and edits the builder's draft, never publishing", async () => {
    const s = await setup();
    mockChat.script = [{ toolCalls: [{ name: "create_booking_experience", input: { kind: "residential", name: "Spring homes" } }] }, { text: "Created." }];
    await ask(s, s.manager, "Make me a residential booking page.");
    const [created] = await resultsOf(s, "create_booking_experience");
    expect(created.status).toBe("done");
    const overview = await s.as.query(api.bookingExperiences.overview, { companyId: s.companyId });
    const experience = overview.experiences.find((e: { name: string }) => e.name === "Spring homes")!;
    expect(experience.status).toBe("draft");

    mockChat.script = [
      { toolCalls: [{ name: "edit_booking_experience", input: { experience: "Spring homes", changes: { featureService: "Deep clean", brandColor: "#0f766e", buildComparison: true, stepCopy: [{ step: "service", title: "Pick your clean" }], addTrust: ["Insured team"] } } }] },
      { text: "Done." },
    ];
    await ask(s, s.manager, "Feature the deep clean, use teal, compare the services, and say we're insured.");
    const [edited] = await resultsOf(s, "edit_booking_experience");
    expect(edited.status).toBe("done");
    const data = edited.data as { changed: string[]; effects: { price: string }; publishReady: boolean; blockers: string[] };
    expect(data.changed.join(" ")).toMatch(/Featured Deep clean/);
    expect(data.effects.price).toMatch(/never change a price/);
    // An unconfirmed trust statement blocks publishing until a person confirms it.
    expect(data.publishReady).toBe(false);
    expect(data.blockers.join(" ")).toMatch(/trust|confirm/i);

    const got = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: experience.id as Id<"bookingExperiences"> });
    expect(got.experience.draftSavedBy).toMatch(/asked by .* in Chat/);
    expect(got.draft.theme.brandColor).toBe("#0f766e");
    expect(got.draft.theme.useCompanyBrand).toBe(false);
    expect(got.draft.services.comparison.rows.map((r: { label: string }) => r.label)).toEqual(expect.arrayContaining(["Wipe counters", "Baseboards"]));
    expect(got.draft.steps.find((x: { id: string }) => x.id === "service")!.copy.title).toBe("Pick your clean");
    expect(got.experience.publishedVersion ?? null).toBeNull();

    // Publishing is not a Chat action, and nothing was published.
    mockChat.script = [{ toolCalls: [{ name: "publish_booking_experience", input: {} }] }, { text: "The Owner publishes it in the builder." }];
    await ask(s, s.as, "Publish it.");
    const [publishing] = await resultsOf(s, "publish_booking_experience");
    expect(publishing.status).not.toBe("done");
    const after = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: experience.id as Id<"bookingExperiences"> });
    expect(after.experience.publishedVersion ?? null).toBeNull();
  });

  it("refuses editing to the office role and refuses a service that isn't published", async () => {
    const s = await setup();
    await s.as.mutation(api.bookingExperiences.create, { companyId: s.companyId, kind: "residential", name: "Homes" });
    expect(mockChat.seen).toEqual([]);
    mockChat.script = [{ text: "Here." }];
    await ask(s, s.office, "What booking pages do we have?");
    expect(mockChat.seen.at(-1)!.tools).toContain("list_booking_experiences");
    expect(mockChat.seen.at(-1)!.tools).not.toContain("edit_booking_experience");

    mockChat.script = [{ toolCalls: [{ name: "edit_booking_experience", input: { experience: "Homes", changes: { featureService: "Window washing" } } }] }, { text: "I can't." }];
    await ask(s, s.manager, "Feature window washing.");
    const [refused] = await resultsOf(s, "edit_booking_experience");
    expect(refused.status).toBe("refused");
  });

  it("explains what keeps each service from an instant firm quote", async () => {
    const s = await setup();
    await s.as.mutation(api.bookingExperiences.create, { companyId: s.companyId, kind: "commercial", name: "Offices" });
    mockChat.script = [{ toolCalls: [{ name: "read_booking_experience", input: { experience: "Offices" } }] }, { text: "Here." }];
    await ask(s, s.manager, "Which questions are preventing instant quotes?");
    const [read] = await resultsOf(s, "read_booking_experience");
    expect(read.status).toBe("done");
    const blockers = (read.data as { quoteBlockers: { service: string; why: string[] }[] }).quoteBlockers;
    expect(blockers[0].service).toBe("Whole page");
    expect(blockers[0].why[0]).toMatch(/walkthrough/);
  });
});
