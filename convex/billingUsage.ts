/**
 * Settings → Plan & Usage → Usage: how much was used, what used it, what it delivered, and what happens
 * at zero. Balances come from Autumn (the copy billing sync keeps); the work behind each charge comes from
 * Selestial's execution records. The Owner only: these are company-wide spending details.
 *
 * Nothing here shows an unverified number. When the copy of Autumn's record is missing, stale or failed
 * to refresh, the overview says "Updating usage" instead of a zero.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { REGISTRY } from "./lib/ai/registry";
import { accountFor, billingState, BLOCK_WORDS, pricing, verifiedPlan } from "./lib/billing/access";
import { AGENT_CATALOG, agentReleased, planIncludesAgent, planIncludesFeature } from "./lib/billing/catalog";
import { TASKS, type Task } from "./lib/billing/rateCards";
import { companyQuery, ownerQuery } from "./lib/builders";

const DAY = 86_400_000;
const STALE_MS = 15 * 60_000;
const ACTIVE = new Set(["reserving", "reserved"]);

type Execution = Doc<"aiExecutions">;
type AgentKey = Execution["agent"];

export function agentLabel(agent: AgentKey): string {
  return agent === "chat" ? "Company Chat" : agent === "studio" ? "Marketing · Creative Studio" : agent === "services" ? "Services & Pricing research" : AGENT_CATALOG[agent].name;
}

/** Fixed order, so an agent keeps its colour whatever the filter shows. */
export const AGENT_ORDER: AgentKey[] = ["chat", "services", "recruiter", "dispatch", "studio", "sales", "retention", "marketing", "quality", "customer-care", "team-coordinator"];

const STATUS_WORDS: Record<Execution["state"], string> = {
  pending: "Waiting",
  reserving: "Starting",
  reserved: "Running",
  completed: "Completed",
  denied: "Not started",
  paused: "Paused",
  failed: "Failed",
  canceled: "Canceled",
  expired: "Expired",
};

function originWords(row: Execution, members: Map<string, string>): { origin: string; initiatedBy: string } {
  const origin = row.origin ?? (row.autonomous ? "automatic" : "member");
  const person = row.memberId ? (members.get(row.memberId) ?? "A former member") : null;
  if (origin === "chat") return { origin: "From Company Chat", initiatedBy: person ?? "Company Chat" };
  if (origin === "automatic") return { origin: "Automatic", initiatedBy: row.agent === "recruiter" ? "Recruiting workflow" : `${agentLabel(row.agent)} workflow` };
  return { origin: "Started in the app", initiatedBy: person ?? "A member" };
}

/** Credits a row stands for: what was charged, what is held right now, or nothing. */
function creditsOf(row: Execution): number {
  if (row.state === "completed") return row.charged ?? 0;
  if (ACTIVE.has(row.state)) return row.credits;
  return 0;
}

/** Why the final charge differs from the estimate, in plain words. */
function adjustment(row: Execution): string | null {
  if (row.state === "completed" && (row.charged ?? 0) < row.credits) return `${row.completedUnits ?? 0} of ${row.units} units were completed. Only those were charged; the other ${row.credits - (row.charged ?? 0)} credits were released.`;
  if (row.settlement === "unbilled") return "The work finished after its credit hold expired, so it was not charged.";
  if (row.settlement === "unverified") return "Billing was degraded when this settled. It is listed for reconciliation; the charge shown is Selestial's record.";
  if (row.state === "expired") return "The work never reported back, so its hold expired and the credits went back.";
  if (row.state === "denied" || row.state === "paused") return row.message ?? (row.block ? BLOCK_WORDS[row.block] : null);
  if (row.state === "failed" || row.state === "canceled") return "Nothing was completed, so nothing was charged and any hold was released.";
  return null;
}

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The current billing cycle and the three before it, from Autumn's reset date when known. */
function cyclesFrom(nextResetAt: number | null, now: number): { from: number; to: number; label: string }[] {
  const out: { from: number; to: number; label: string }[] = [];
  let end = nextResetAt ?? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);
  for (let i = 0; i < 4; i += 1) {
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    out.push({ from: start.getTime(), to: end, label: i === 0 ? "Current cycle" : `${new Date(start.getTime()).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date(end - 1).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` });
    end = start.getTime();
  }
  return out;
}

export const usage = ownerQuery({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    agent: v.optional(v.string()),
    task: v.optional(v.string()),
    status: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = billingState();
    if (!state.connected) return { connected: false as const, message: state.message };
    const account = await accountFor(ctx, ctx.companyId, state.env);
    const plan = verifiedPlan(ctx.company);
    const cycles = cyclesFrom(account?.credits?.nextResetAt ?? null, now);
    const from = args.from ?? cycles[0].from;
    const to = Math.min(args.to ?? cycles[0].to, now + DAY);
    const span = Math.max(DAY, to - from);

    const rows = (
      await ctx.db
        .query("aiExecutions")
        .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId).gte("createdAt", Math.min(from - span, cycles[0].from)))
        .order("desc")
        .take(8000)
    ).filter((row) => row.env === state.env);
    const inRange = rows.filter((row) => row.createdAt >= from && row.createdAt < to);
    const before = rows.filter((row) => row.createdAt >= from - span && row.createdAt < from);
    const members = new Map((await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", ctx.companyId)).take(500)).map((row) => [row._id as string, row.name]));

    // ── 1. Overview: Autumn's verified balance, or "updating" ──
    const reserved = rows.filter((row) => ACTIVE.has(row.state)).reduce((sum, row) => sum + row.credits, 0);
    const updating = !account || account.syncProblem !== undefined || now - account.syncedAt > STALE_MS;
    const credits = account?.credits ?? null;
    const overview = {
      updating,
      syncedAt: account?.syncedAt ?? null,
      available: credits?.remaining ?? null,
      usedThisCycle: credits ? Math.max(0, credits.included.granted - credits.included.remaining) + Math.max(0, credits.purchased.granted - credits.purchased.remaining) : null,
      reserved,
      nextResetAt: credits?.nextResetAt ?? null,
      monthly: credits ? { granted: credits.included.granted, remaining: credits.included.remaining } : null,
      purchased: credits ? { granted: credits.purchased.granted, remaining: credits.purchased.remaining, expiresAt: credits.purchased.expiresAt } : null,
      plan,
      zero: credits !== null && !updating && credits.remaining <= 0,
    };

    // ── 2. Usage over time: completed, charged work per day ──
    const days: string[] = [];
    for (let at = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate()); at < to; at += DAY) days.push(dayKey(at));
    const charged = (list: Execution[]) => list.filter((row) => row.state === "completed" && (row.charged ?? 0) > 0);
    const series = days.map((day) => ({ day, byAgent: {} as Record<string, number>, byTask: {} as Record<string, number>, total: 0 }));
    const index = new Map(series.map((row, i) => [row.day, i]));
    for (const row of charged(inRange)) {
      const slot = series[index.get(dayKey(row.createdAt)) ?? -1];
      if (!slot) continue;
      slot.byAgent[row.agent] = (slot.byAgent[row.agent] ?? 0) + (row.charged ?? 0);
      slot.byTask[row.task] = (slot.byTask[row.task] ?? 0) + (row.charged ?? 0);
      slot.total += row.charged ?? 0;
    }
    const previous = days.map(() => 0);
    for (const row of charged(before)) {
      const i = Math.floor((row.createdAt - (from - span)) / DAY);
      if (i >= 0 && i < previous.length) previous[i] += row.charged ?? 0;
    }

    // A forecast only with real history: at least 7 days into the cycle and two weeks of use overall.
    let forecast: string | null = null;
    const firstUse = rows.length ? Math.min(...rows.map((row) => row.createdAt)) : null;
    const elapsedDays = (now - cycles[0].from) / DAY;
    if (credits && overview.monthly && overview.monthly.granted > 0 && elapsedDays >= 7 && firstUse !== null && now - firstUse >= 14 * DAY) {
      const used = overview.monthly.granted - overview.monthly.remaining;
      const perDay = used / elapsedDays;
      if (perDay > 0) {
        const runsOutAt = now + (overview.monthly.remaining / perDay) * DAY;
        if (credits.nextResetAt && runsOutAt < credits.nextResetAt) forecast = `At your recent usage rate, your monthly credits may run out before ${new Date(runsOutAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}.`;
      }
    }

    // ── 3. Where credits went ──
    const done = charged(inRange);
    const total = done.reduce((sum, row) => sum + (row.charged ?? 0), 0);
    const share = (value: number) => (total > 0 ? Math.round((1000 * value) / total) / 10 : 0);
    const agentKeys = AGENT_ORDER.filter((key) => key === "chat" || key === "services" || done.some((row) => row.agent === key) || (key === "studio" ? planIncludesFeature(plan, "creative_studio") : key in AGENT_CATALOG && agentReleased(key as never) && planIncludesAgent(plan, key as never)));
    const byAgent = agentKeys.map((key) => {
      const list = done.filter((row) => row.agent === key);
      const value = list.reduce((sum, row) => sum + (row.charged ?? 0), 0);
      return { key, label: agentLabel(key), units: list.reduce((sum, row) => sum + (row.completedUnits ?? 0), 0), credits: value, share: share(value) };
    });
    const byTask = (Object.keys(TASKS) as Task[])
      .filter((task) => TASKS[task].available || done.some((row) => row.task === task))
      .map((task) => {
        const list = done.filter((row) => row.task === task);
        const value = list.reduce((sum, row) => sum + (row.charged ?? 0), 0);
        return { key: task, label: TASKS[task].label, units: list.reduce((sum, row) => sum + (row.completedUnits ?? 0), 0), credits: value, share: share(value) };
      });

    // ── 4. Work delivered: real completed counts, each opening its work ──
    const delivered = new Map<string, { agent: string; task: string; units: number; credits: number; link: { label: string; path: string } | null }>();
    for (const row of done) {
      const key = `${row.agent}:${row.task}`;
      const entry = delivered.get(key) ?? { agent: agentLabel(row.agent), task: TASKS[row.task].label, units: 0, credits: 0, link: row.link ?? null };
      entry.units += row.completedUnits ?? 0;
      entry.credits += row.charged ?? 0;
      delivered.set(key, entry);
    }

    // ── 5. Activity, filtered ──
    const needle = args.search?.trim().toLowerCase() ?? "";
    const activity = inRange
      .filter((row) => !args.agent || row.agent === args.agent)
      .filter((row) => !args.task || row.task === args.task)
      .filter((row) => !args.status || STATUS_WORDS[row.state] === args.status)
      .filter((row) => !args.memberId || row.memberId === args.memberId)
      .map((row) => {
        const words = originWords(row, members);
        return { id: row._id, at: row.createdAt, agent: agentLabel(row.agent), agentKey: row.agent, origin: words.origin, action: TASKS[row.task].label, record: row.link ?? null, status: STATUS_WORDS[row.state], credits: creditsOf(row), held: ACTIVE.has(row.state), initiatedBy: words.initiatedBy };
      })
      .filter((row) => !needle || `${row.agent} ${row.action} ${row.status} ${row.initiatedBy} ${row.origin} ${row.record?.label ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 100);

    // ── 8. Texts and email: their own units, never credits ──
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_company_queued", (q) => q.eq("companyId", ctx.companyId).gte("queuedAt", from).lt("queuedAt", to))
      .take(5000);
    const channel = (name: "sms" | "email") => {
      // Selestial's own notices to members are free and aren't the company's messaging, so they aren't counted.
      const list = messages.filter((row) => (row.channel ?? "sms") === name && row.purpose !== "member_notice");
      return { total: list.length, sent: list.filter((row) => row.status === "sent" || row.status === "delivered").length, failed: list.filter((row) => row.status === "failed" || row.status === "not_sent").length };
    };

    return {
      connected: true as const,
      env: state.env,
      problem: state.problem,
      range: { from, to },
      cycles,
      overview,
      series,
      previous,
      forecast,
      byAgent,
      byTask,
      delivered: [...delivered.values()].sort((a, b) => b.credits - a.credits),
      activity,
      truncated: rows.length === 8000,
      filters: {
        agents: AGENT_ORDER.filter((key) => rows.some((row) => row.agent === key)).map((key) => ({ key, label: agentLabel(key) })),
        tasks: (Object.keys(TASKS) as Task[]).filter((task) => rows.some((row) => row.task === task)).map((task) => ({ key: task, label: TASKS[task].label })),
        statuses: [...new Set(Object.values(STATUS_WORDS))],
        members: [...members.entries()].map(([id, name]) => ({ id: id as Id<"members">, name })),
      },
      ledger: account?.ledger ?? null,
      communication: { sms: channel("sms"), email: channel("email"), voice: null as null },
      controls: account?.controls ?? null,
      budgetAgents: AGENT_ORDER.filter((key) => key === "chat" || key === "services" || (key === "studio" ? planIncludesFeature(plan, "creative_studio") : key in AGENT_CATALOG && agentReleased(key as never) && planIncludesAgent(plan, key as never))).map((key) => ({ key, label: agentLabel(key) })),
      priceList: priceList(state.card),
    };
  },
});

/** "What costs credits?": the published rates and exactly what each covers. */
function priceList(card: ReturnType<typeof billingState> extends infer S ? (S extends { card: infer C } ? C : null) : null) {
  if (!card) return null;
  const model = (capability: keyof typeof REGISTRY) => REGISTRY[capability]?.primary?.model ?? null;
  const details: Partial<Record<Task, { model: string | null; setup: string }>> = {
    image_generation: { model: model("image_generate"), setup: card.specs?.image_generation?.describe ?? "Every size Creative Studio offers, one image per charge." },
    image_edit: { model: model("image_edit"), setup: card.specs?.image_edit?.describe ?? "Every size Creative Studio offers, one edited image per charge." },
    video_generation: { model: model("video_generate"), setup: card.specs?.video_generation?.describe ?? "One clip per charge." },
  };
  return {
    version: card.version,
    fixture: card.fixture,
    rows: (Object.keys(TASKS) as Task[])
      .filter((task) => TASKS[task].available)
      .map((task) => ({ task, label: TASKS[task].label, unit: TASKS[task].unit, credits: card.rates[task], startingAt: card.startingAt?.[task] === true, model: details[task]?.model ?? null, setup: details[task]?.setup ?? null })),
    free: ["Scheduling, assignments and status changes", "Opening and answering cleaner text-message links", "Viewing and editing records", "Simple scheduled reminders", "Searching your documents"],
  };
}

/** One row of the activity table, opened: estimate and final charge, every step of the charge, and why. */
export const execution = ownerQuery({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row || row.companyId !== ctx.companyId) return null;
    const members = new Map((await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", ctx.companyId)).take(500)).map((member) => [member._id as string, member.name]));
    const words = originWords(row, members);
    return {
      id: row._id,
      at: row.createdAt,
      agent: agentLabel(row.agent),
      action: TASKS[row.task].label,
      unit: TASKS[row.task].unit,
      status: STATUS_WORDS[row.state],
      origin: words.origin,
      initiatedBy: words.initiatedBy,
      estimate: row.credits,
      final: row.state === "completed" ? (row.charged ?? 0) : ACTIVE.has(row.state) ? null : 0,
      units: row.units,
      completedUnits: row.completedUnits ?? null,
      rate: row.rate,
      rateCard: row.rateCardVersion,
      settlement: row.settlement,
      history: row.history ?? [],
      link: row.link ?? null,
      explanation: adjustment(row),
    };
  },
});

/**
 * The exact credit cost of a piece of work before it starts, for its exact setup. Creative Studio shows it
 * before a generation; a "starting at" price always resolves here to an exact number or a clear refusal.
 */
export const estimate = companyQuery({
  args: { task: v.union(v.literal("image_generation"), v.literal("image_edit"), v.literal("video_generation")), units: v.number(), size: v.optional(v.string()), fast: v.optional(v.boolean()), durationSeconds: v.optional(v.number()) },
  handler: async (_ctx, args) => {
    const units = Math.max(1, Math.min(10, Math.floor(args.units)));
    const price = pricing(args.task, units, { size: args.size, fast: args.fast, durationSeconds: args.durationSeconds });
    return price.ok ? { ok: true as const, credits: price.credits, rate: price.rate, rateCard: price.card.version } : { ok: false as const, message: price.message };
  },
});
