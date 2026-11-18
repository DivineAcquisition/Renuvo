import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyProvider, type Role } from "@/components/app/company";
import { menuSections, SETTINGS_SECTIONS, sectionsFor } from "@/lib/app/settings";

import type { Id } from "../../../../convex/_generated/dataModel";

// ── The Convex and Next hooks, replaced by what a test hands them ───────────────────────────────────

const calls: { name: string; args: unknown }[] = [];
let data: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    return args === "skip" ? undefined : data[name];
  },
  usePaginatedQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    calls.push({ name: getFunctionName(ref), args });
    return { results: [], status: args === "skip" ? "LoadingFirstPage" : "Exhausted", loadMore: () => undefined };
  },
  useMutation: () => async () => undefined,
}));
let search = "";
vi.mock("next/navigation", () => ({ usePathname: () => "/app/settings/business", useRouter: () => ({ replace: () => undefined }), useSearchParams: () => new URLSearchParams(search) }));

const { BusinessDraftProvider } = await import("@/components/app/settings/business-draft");
const { BusinessSection } = await import("@/components/app/settings/business-sections");
const { PlanBilling } = await import("@/components/app/settings/billing");
const { OverviewGrid, commonTasksFor } = await import("@/components/app/settings/overview");
const { SettingsNavList } = await import("@/components/app/settings/nav");

const companyId = "company1" as Id<"companies">;
const business = (over: Record<string, unknown> = {}) => ({
  revision: 3,
  name: "Elm Cleaning",
  timezone: "America/Chicago",
  serviceAreas: ["78701"],
  hours: [{ weekday: 1, startMinute: 480, endMinute: 1020 }],
  services: [],
  configured: true,
  canEdit: true,
  ...over,
});

function page(role: Role, node: React.ReactNode) {
  return renderToStaticMarkup(
    <CompanyProvider company={{ companyId, name: "Elm Cleaning", timezone: "America/Chicago", role }}>
      <BusinessDraftProvider>{node}</BusinessDraftProvider>
    </CompanyProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  data = {};
});

describe("business settings forms", () => {
  it("shows the Owner editable fields and a save control", () => {
    data["settings:business"] = business();
    const html = page("owner", <BusinessSection />);
    expect(html).toContain("Elm Cleaning");
    expect(html).toContain("78701");
    expect(html).toContain("Save changes");
    expect(html).toContain("All changes saved.");
    expect(html).not.toMatch(/<input[^>]*disabled=""[^>]*value="Elm Cleaning"/);
    // The time zone is shown by its place, never as its identifier alone.
    expect(html).toContain("Central Time (Chicago, Dallas, Houston)");
    expect(html).not.toContain("IANA");
  });

  it("shows everyone else the same values, read only", () => {
    data["settings:business"] = business({ canEdit: false });
    const html = page("office", <BusinessSection />);
    expect(html).toContain("Elm Cleaning");
    expect(html).not.toContain("Save changes");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="Elm Cleaning"/);
    expect(html).toContain("Monday: 8:00 AM to 5:00 PM");
  });

  it("says empty hours and areas mean no limit, not closed", () => {
    data["settings:business"] = business({ hours: [], serviceAreas: [], configured: false });
    const html = page("owner", <BusinessSection />);
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*>[\s\S]*?Customers can book at any time/);
    expect(html).toContain("You serve every ZIP code.");
    data["settings:business"] = business({ hours: [], serviceAreas: [], configured: false, canEdit: false });
    const readOnly = page("office", <BusinessSection />);
    expect(readOnly).toContain("Customers can book at any time. There is no company-wide limit.");
  });

  it("shows set hours by day, with closed days said plainly", () => {
    data["settings:business"] = business();
    const html = page("owner", <BusinessSection />);
    expect(html).toContain("Only during the hours below");
    expect(html).toContain("Monday");
    expect(html).toContain("Closed for booking");
    expect(html).toContain('aria-label="Monday opens"');
  });
});

describe("plan and usage", () => {
  const catalog = {
      plans: [
        { id: "operate", name: "Operate", monthlyCents: 29900, positioning: "", summary: "Keep sales, hiring, dispatch, and retention moving from one workspace." },
        { id: "expand", name: "Expand", monthlyCents: 49900, positioning: "", summary: "Add marketing, quality, customer care, and team coordination." },
      ],
      bothInclude: ["Company Chat"],
      agents: [
        { agent: "dispatch", name: "Dispatch", department: "operations", released: true, operate: true, expand: true, here: false },
        { agent: "quality", name: "Quality", department: "operations", released: false, operate: false, expand: true, here: false },
      ],
      features: [{ feature: "customer_portal", name: "Customer portal", built: false, expandOnly: true, here: false }],
    };

  it("never asks the server for billing unless the person is the Owner", () => {
    data["billing:planAndUsage"] = { connected: false, message: "Billing is not connected.", plan: null, catalog };
    for (const role of ["manager", "office"] as const) {
      const html = renderToStaticMarkup(
        <CompanyProvider company={{ companyId, name: "Elm", timezone: "UTC", role }}>
          <PlanBilling />
        </CompanyProvider>,
      );
      expect(html).toContain("is for the Owner");
    }
    const asked = calls.filter((call) => call.name === "billing:planAndUsage");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((call) => call.args === "skip")).toBe(true);
  });

  it("without billing connected, shows the two plans and labels what is unreleased, with nothing to buy", () => {
    data["billing:planAndUsage"] = { connected: false, message: "Billing is not connected on this deployment, so AI work is paused.", plan: null, catalog };
    const html = renderToStaticMarkup(
      <CompanyProvider company={{ companyId, name: "Elm", timezone: "UTC", role: "owner" }}>
        <PlanBilling />
      </CompanyProvider>,
    );
    expect(html).toContain("$299<");
    expect(html).toContain("$499<");
    expect(html).toContain("available for your account yet");
    expect(html).not.toContain("deployment");
    expect(html).toContain("not released yet");
    expect(html).toContain("Included when released");
    expect(html).toContain("not available yet");
    expect(html).not.toMatch(/Choose Operate|Choose Expand|Add \d|Confirm and pay/);
  });
});

describe("the Usage tab", () => {
  const connected = {
    connected: true,
    env: "sandbox",
    problem: null,
    rateCard: null,
    plan: "operate",
    catalog: { plans: [], bothInclude: [], agents: [], features: [] },
    account: { plan: "operate", subscription: { pastDue: false, startedAt: 1, periodEnd: 2, endsAt: null, scheduledPlan: null, scheduledAt: null }, credits: null, reserved: 0, controls: { alertPercents: [80], autoTopUp: { enabled: false } }, notices: [], invoices: [], syncedAt: 1, syncProblem: null },
    usage: [],
    recent: [],
    topUps: { packs: [], validity: "", consumption: "" },
    pendingIntent: null,
  };
  const base = {
    connected: true,
    env: "sandbox",
    problem: null,
    range: { from: Date.UTC(2026, 10, 1), to: Date.UTC(2026, 10, 4) },
    cycles: [{ from: Date.UTC(2026, 10, 1), to: Date.UTC(2026, 11, 1), label: "Current cycle" }],
    series: [
      { day: "2026-11-01", byAgent: { chat: 3, recruiter: 2 }, byTask: { chat_response_standard: 3, hiring_message_reading: 2 }, total: 5 },
      { day: "2026-11-02", byAgent: {}, byTask: {}, total: 0 },
      { day: "2026-11-03", byAgent: { recruiter: 1 }, byTask: { hiring_message_reading: 1 }, total: 1 },
    ],
    previous: [0, 0, 0],
    forecast: null,
    byAgent: [
      { key: "chat", label: "Company Chat", units: 3, credits: 3, share: 50 },
      { key: "recruiter", label: "Recruiter", units: 3, credits: 3, share: 50 },
      { key: "dispatch", label: "Dispatch", units: 0, credits: 0, share: 0 },
    ],
    byTask: [
      { key: "chat_response_standard", label: "Chat response", units: 3, credits: 3, share: 50 },
      { key: "hiring_message_reading", label: "Hiring email read by AI", units: 3, credits: 3, share: 50 },
    ],
    delivered: [{ agent: "Recruiter", task: "Hiring email read by AI", units: 3, credits: 3, link: { label: "Hiring inbox", path: "/app/settings/recruiting" } }],
    activity: [{ id: "e1", at: Date.UTC(2026, 10, 3, 15, 42), agent: "Recruiter", agentKey: "recruiter", origin: "Automatic", action: "Hiring email read by AI", record: { label: "Hiring inbox", path: "/app/settings/recruiting" }, status: "Completed", credits: 1, held: false, initiatedBy: "Recruiting workflow" }],
    truncated: false,
    filters: { agents: [], tasks: [], statuses: ["Completed"], members: [] },
    ledger: null,
    communication: { sms: { total: 4, sent: 4, failed: 0 }, email: { total: 2, sent: 2, failed: 0 }, voice: null },
    controls: { alertPercents: [50, 80, 100], autoTopUp: { enabled: false } },
    budgetAgents: [{ key: "chat", label: "Company Chat" }],
    priceList: { version: "2026-11", fixture: false, rows: [{ task: "video_generation", label: "Video generated", unit: "", credits: 200, startingAt: true, model: "veo", setup: "One 6-second clip" }], free: ["Opening and answering cleaner text-message links"] },
  };
  const render = () =>
    renderToStaticMarkup(
      <CompanyProvider company={{ companyId, name: "Elm", timezone: "UTC", role: "owner" }}>
        <PlanBilling />
      </CompanyProvider>,
    );

  it("says 'Updating usage' instead of showing an unverified zero", () => {
    search = "tab=usage";
    data["billing:planAndUsage"] = connected;
    data["billingUsage:usage"] = { ...base, overview: { updating: true, syncedAt: null, available: null, usedThisCycle: null, reserved: 0, nextResetAt: null, monthly: null, purchased: null, plan: "operate", zero: false } };
    const html = render();
    expect(html).toContain("Updating usage");
    expect(html).not.toContain("No credits left");
    search = "";
  });

  it("shows the balance, where credits went, the work delivered, activity, the price list and texts apart from credits", () => {
    search = "tab=usage";
    data["billing:planAndUsage"] = connected;
    data["billingUsage:usage"] = { ...base, overview: { updating: false, syncedAt: 1, available: 4994, usedThisCycle: 6, reserved: 2, nextResetAt: Date.UTC(2026, 11, 1), monthly: { granted: 5000, remaining: 4994 }, purchased: { granted: 0, remaining: 0, expiresAt: null }, plan: "operate", zero: false } };
    const html = render();
    for (const text of ["Available", "4,994", "credits left", "Used this cycle", "Reserved", "Resets", "Monthly credits", "Purchased credits", "Buy credits", "Manage spending", "Usage over time", "Agents at work", "Company Chat", "Recruiter", "Work delivered", "Activity and credit history", "Recruiting workflow", "Spending controls", "Hard limits", "What costs credits?", "From 200 credits", "Texts, email and calls"]) expect(html, text).toContain(text);
    // Credits and money are never added together.
    expect(html).not.toMatch(/\$\d/);
    search = "";
  });

  it("at zero credits says what pauses and what keeps working", () => {
    search = "tab=usage";
    data["billing:planAndUsage"] = connected;
    data["billingUsage:usage"] = { ...base, overview: { updating: false, syncedAt: 1, available: 0, usedThisCycle: 5000, reserved: 0, nextResetAt: Date.UTC(2026, 11, 1), monthly: { granted: 5000, remaining: 0 }, purchased: { granted: 0, remaining: 0, expiresAt: null }, plan: "operate", zero: true } };
    const html = render();
    expect(html).toContain("No credits left. New AI work is paused.");
    expect(html).toContain("cleaner text-message links");
    search = "";
  });
});

describe("the Messaging tab", () => {
  const plan = {
    connected: true,
    env: "sandbox",
    problem: null,
    rateCard: null,
    plan: "operate",
    catalog: { plans: [{ id: "operate", name: "Operate", monthlyCents: 29900, positioning: "", summary: "" }], bothInclude: [], agents: [], features: [] },
    account: { plan: "operate", subscription: { pastDue: false, startedAt: 1, periodEnd: 2, endsAt: null, scheduledPlan: null, scheduledAt: null }, credits: { granted: 5000, remaining: 4000, used: 1000, nextResetAt: null, included: { granted: 5000 } }, reserved: 0, controls: { alertPercents: [80], autoTopUp: { enabled: false } }, notices: [], invoices: [], syncedAt: 1, syncProblem: null },
    usage: [],
    recent: [],
    topUps: { packs: [], validity: "", consumption: "" },
    pendingIntent: null,
  };
  const rateCard = {
    version: "msg-2026-11",
    effectiveFrom: Date.UTC(2026, 10, 18),
    rows: [
      { kind: "sms_out", label: "Outbound text", per: "segment", price: 250 },
      { kind: "sms_in", label: "Inbound text", per: "segment", price: 150 },
      { kind: "mms_out", label: "Outbound picture message", per: "message", price: 500 },
      { kind: "mms_in", label: "Inbound picture message", per: "message", price: 400 },
      { kind: "email_out", label: "Business email (Selestial delivery)", per: "recipient", price: 20 },
    ],
    numberMonthly: 30000,
    included: ["Approval alerts and daily digests", "Email sent through your connected Gmail (Google delivers it)"],
    unavailable: ["International numbers, including Canada"],
  };
  const overview = (over: Record<string, unknown> = {}) => ({
    connected: true,
    metering: true,
    env: "sandbox",
    hasPlan: true,
    balance: { available: 182_500, reserved: 500, purchased: 182_500, promotional: { remaining: 0, expiresAt: null }, negative: false, overdraftFloor: -100_000, at: 1 },
    month: { from: Date.UTC(2026, 10, 1), outbound: 67_500, inbound: 1_500, fees: 0, credits: 0, total: 69_000, byKind: [{ kind: "sms_out", label: "Outbound text", count: 270, amount: 67_500 }, { kind: "sms_in", label: "Inbound text", count: 10, amount: 1_500 }, { kind: "email_out", label: "Business email (Selestial delivery)", count: 0, amount: 0 }], byAgent: [{ key: "sales", label: "Sales", amount: 50_000, count: 200 }, { key: "inbound", label: "Replies and incoming texts", amount: 1_500, count: 10 }], limit: 100_000 },
    controls: { monthlyLimit: 100_000, batchLimit: null, lowBalance: 50_000, agentLimits: [{ agent: "sales", label: "Sales", limit: 50_000, spent: 50_000 }], autoTopUp: { enabled: false, threshold: 50_000, amount: 250_000, monthlyMax: 1_000_000, authorizedAt: null, authorizedBy: null, usedThisMonth: 0 } },
    held: [{ key: "sales", label: "Sales", reason: "messaging_balance", count: 18, stale: 0, estimate: 4_500, words: "Add messaging funds to send them." }],
    recent: [{ at: Date.UTC(2026, 10, 18, 15), what: "Message to a client", kind: "Outbound text", detail: "2 segments", who: "Sales", status: "Charged", amount: 500, final: true }],
    payments: [{ at: Date.UTC(2026, 10, 2), source: "Added by you", cents: 2_500, amount: 250_000, status: "Paid", problem: null, receipt: "https://pay.example/r1", returned: 0 }],
    rateCard,
    options: { presets: [2_500, 5_000, 10_000], minCents: 1_000, maxCents: 100_000 },
    ...over,
  });
  const render = () =>
    renderToStaticMarkup(
      <CompanyProvider company={{ companyId, name: "Elm", timezone: "UTC", role: "owner" }}>
        <PlanBilling />
      </CompanyProvider>,
    );

  it("shows the balance, what is set aside, held work, funds, auto top-up, spend, controls, charges, payments, prices and the statement", () => {
    search = "tab=messaging";
    data["billing:planAndUsage"] = plan;
    data["messagingUsage:overview"] = overview();
    data["messagingUsage:statement"] = { company: "Elm", month: "2026-11", timezone: "UTC", lines: [], funds: [], totals: { charged: 0, added: 0 } };
    const html = render();
    for (const text of [
      "Messaging balance",
      "$18.25",
      "Set aside for sending",
      "$0.05",
      "$6.75 of $10.00",
      "Sales prepared 18 messages. Add messaging funds to send them.",
      "About $0.45 to send now",
      "Add funds",
      "Whole dollars from $10 to $1,000",
      "Automatic top-up",
      "Off unless you turn it on",
      "I authorize Selestial to charge my saved payment method $25.00",
      "Turn on automatic top-up",
      "This month",
      "Replies and incoming texts",
      "Taxes, if any, are on your receipts",
      "Spending controls",
      "never give anyone permission to send",
      "Monthly limit for each agent",
      "Recent charges",
      "2 segments",
      "Funds added",
      "Receipt",
      "Messaging prices",
      "$0.025",
      "per segment",
      "$0.002",
      "per recipient",
      "$3.00",
      "At cost, shown before you agree",
      "This message uses 2 SMS segments. Estimated cost: $0.05.",
      "Included, never charged",
      "International numbers",
      "Download statement (CSV)",
    ])
      expect(html, text).toContain(text);
    // The authorization box starts unticked, so turning automatic top-up on is a deliberate act.
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    // No developer references in what the Owner reads.
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/msg-2026|lock|provider|_id/i);
    search = "";
  });

  it("at a negative balance says outgoing is paused, replies still arrive, and the number is kept", () => {
    search = "tab=messaging";
    data["billing:planAndUsage"] = plan;
    data["messagingUsage:overview"] = overview({ balance: { available: -1_500, reserved: 0, purchased: 0, promotional: { remaining: 0, expiresAt: null }, negative: true, overdraftFloor: -100_000, at: 1 } });
    const html = render();
    expect(html).toContain("-$0.15");
    expect(html).toContain("Outgoing texts and business email are paused and kept as drafts");
    expect(html).toContain("opt-outs always work");
    expect(html).toContain("never released for a low balance");
    search = "";
  });

  it("shows the plan, AI credits and messaging balance as three separate things on the Plan tab", () => {
    search = "tab=plan";
    data["billing:planAndUsage"] = plan;
    data["messagingUsage:overview"] = overview();
    const html = render();
    for (const text of ["What you pay for", "AI credits", "4,000 left", "Sending a ready message never uses credits", "Messaging balance", "$18.25", "Never expires"]) expect(html, text).toContain(text);
    search = "";
  });
});

function pagePatterns(dir: string, segments: string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pagePatterns(full, /^\(.*\)$/.test(name) ? segments : [...segments, name]));
    else if (name === "page.tsx") out.push(`/${segments.join("/")}`);
  }
  return out;
}

describe("the overview and navigation", () => {
  const pages = pagePatterns(path.join(process.cwd(), "src/app"));

  it("links every section the Owner may open, and each one is a real page", () => {
    const html = renderToStaticMarkup(<OverviewGrid sections={sectionsFor("owner")} />);
    expect(SETTINGS_SECTIONS).toHaveLength(12); // Services & pricing moved to Company → Services & Pricing.
    for (const section of SETTINGS_SECTIONS) {
      expect(html, section.id).toContain(`href="${section.path}"`);
      expect(html, section.id).toContain(section.label.replace("&", "&amp;"));
      expect(pages, section.path).toContain(section.path);
    }
  });

  it("leaves the Owner-only sections out for everyone else", () => {
    for (const role of ["manager", "office"] as const) {
      const html = renderToStaticMarkup(<OverviewGrid sections={sectionsFor(role)} />);
      expect(html).not.toContain("/app/settings/billing");
      expect(html).not.toContain("/app/settings/activity");
      expect(html).toContain("/app/settings/business");
    }
  });

  it("marks the current page and says when a search finds nothing", () => {
    const html = renderToStaticMarkup(<SettingsNavList sections={SETTINGS_SECTIONS} activeId="people" />);
    expect(html).toMatch(/href="\/app\/settings\/people"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/app\/settings\/people"/);
    expect(renderToStaticMarkup(<SettingsNavList sections={[]} activeId={undefined} />)).toContain("No settings match that");
  });

  it("groups the menu the way owners think about it", () => {
    const html = renderToStaticMarkup(<SettingsNavList sections={menuSections(SETTINGS_SECTIONS)} activeId={undefined} />);
    for (const group of ["Company", "Your agents", "Apps &amp; billing", "Account &amp; privacy"]) expect(html).toContain(group);
    for (const label of ["Business details", "Agent controls", "Connected apps", "Privacy &amp; messaging", "Selestial terms", "Activity"]) expect(html).toContain(label);
    // Google and AI features are reached from their parent pages, not listed twice.
    expect(html).not.toContain('href="/app/settings/google"');
    expect(html).not.toContain('href="/app/settings/ai"');
  });

  it("offers owners the common tasks first, and only tasks a role can do", () => {
    expect(commonTasksFor("owner").map((row) => row.section)).toEqual(["business", "services", "people", "agents", "integrations", "billing"]);
    // Services left Settings: its task opens Company → Services & Pricing, and it is not a Settings page.
    expect(commonTasksFor("owner").find((row) => row.section === "services")?.href).toBe("/app/services");
    expect(SETTINGS_SECTIONS.some((row) => row.id === "services")).toBe(false);
    expect(commonTasksFor("office")).toEqual([]);
  });
});

describe("when a part of Settings cannot load", () => {
  it("says what to do, and never shows what went wrong inside", async () => {
    const { Unavailable } = await import("@/components/app/settings/guard");
    const html = renderToStaticMarkup(<Unavailable error={new Error("Could not find public function for 'settings:business'\nstack...")} />);
    expect(html).toContain("couldn&#x27;t load right now");
    expect(html).toContain("Refresh the page");
    expect(html).not.toMatch(/Convex|function|stack|deploy/i);
  });
});
