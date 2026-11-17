import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyProvider, type Role } from "@/components/app/company";

import type { Id } from "../../../../convex/_generated/dataModel";
import { quote } from "../../../../convex/lib/services/engine";
import { emptyCosts, profitability } from "../../../../convex/lib/services/profit";
import { blankSpec, type Spec } from "../../../../convex/lib/services/spec";
import { TEMPLATES } from "../../../../convex/lib/services/templates";

// ── Convex and Next, replaced by what each test hands them ──────────────────────────────────────────

let data: Record<string, unknown> = {};
let pathname = "/app/services";
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => (args === "skip" ? undefined : data[getFunctionName(ref)]),
  useMutation: () => async () => undefined,
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams("mode=template") }));

const { ServicesLayout } = await import("./layout");
const { ServicesHome } = await import("./home");
const { NewService } = await import("./new");
const { ServiceBuilder } = await import("./builder");
const { ChangeReview, beforeAfter } = await import("./changes");
const { QuoteLines, ProfitPanel, CustomerView, TeamView } = await import("./preview");
const { MoneyInput, Toggle, Stepper, InfoTip } = await import("./shared");
const { PricingStep, ExtrasStep } = await import("./steps");
const { marginStanding, PriceStrip } = await import("./visuals");
const { setupSteps } = await import("./home");
const { ResearchHome } = await import("./research");

const companyId = "company1" as Id<"companies">;
function render(role: Role, node: React.ReactNode) {
  return renderToStaticMarkup(<CompanyProvider company={{ companyId, name: "Elm Cleaning", timezone: "America/Chicago", role }}>{node}</CompanyProvider>);
}

const catalog = (over: Record<string, unknown> = {}) => ({ role: "owner", canDraft: true, canPublish: true, legacyWaiting: 0, setupDone: true, services: [], counts: { active: 0, drafts: 0, waiting: 0, archived: 0 }, ...over });

const spec = (patch: Partial<Spec> = {}): Spec => ({
  ...blankSpec("residential"),
  name: "Standard clean",
  summary: "A full clean.",
  included: [{ id: "oven", label: "Inside the oven", section: "Kitchen", requiresPhoto: true }],
  excluded: ["Exterior windows"],
  pricing: { method: "fixed", amountCents: 15000, laborMinutes: 120 },
  addOns: [{ id: "oven-extra", label: "Oven interior", priceCents: 3500, per: "visit", laborMinutes: 30, maxQuantity: 1, coversItemId: "oven" }],
  ...patch,
});

beforeEach(() => {
  data = {};
  pathname = "/app/services";
});

describe("the workspace frame", () => {
  it("offers the four ways to start to Owners and Managers only", () => {
    data["services:catalog"] = catalog();
    const owner = render("owner", <ServicesLayout>x</ServicesLayout>);
    for (const action of ["Build with Selestial", "Use a template", "Add a service", "Import existing pricing"]) expect(owner).toContain(action);
    const office = render("office", <ServicesLayout>x</ServicesLayout>);
    expect(office).not.toContain("Build with Selestial");
    expect(office).toContain("Selestial&#x27;s own plans and credits are under Settings");
  });

  it("marks the current tab and counts what is waiting", () => {
    pathname = "/app/services/changes/abc";
    data["services:catalog"] = catalog({ counts: { active: 1, drafts: 0, waiting: 2, archived: 0 } });
    const html = render("owner", <ServicesLayout>x</ServicesLayout>);
    expect(html).toMatch(/aria-current="page"[^>]*>Changes|Changes<span[^>]*>2 waiting/);
    expect(html).toContain("2 waiting");
  });
});

describe("the first visit", () => {
  it("shows the three ways to begin, not a blank list", () => {
    data["services:catalog"] = catalog({ setupDone: false });
    const html = render("owner", <ServicesHome />);
    expect(html).toContain("Help me build my services");
    expect(html).toContain("Start with a template");
    expect(html).toContain("Bring my existing pricing");
    expect(html).toContain("I&#x27;m not sure");
  });

  it("tells Office plainly who adds services", () => {
    data["services:catalog"] = catalog({ canDraft: false, canPublish: false });
    expect(render("office", <ServicesHome />)).toContain("The Owner or a Manager adds the company&#x27;s services here");
  });

  it("labels template amounts as illustrative and lists what the company must confirm", () => {
    const html = render("owner", <NewService />);
    expect(html).toContain("Templates are structure, not your rates");
    expect(html).toContain("Illustrative amounts");
    expect(TEMPLATES.filter((t) => t.category === "residential").every((t) => html.includes(t.name.replace("/", "/")))).toBe(true);
  });
});

describe("prices always carry their unit", () => {
  it("writes the unit beside a typed amount", () => {
    const html = renderToStaticMarkup(<MoneyInput label="Rate" unit="per cleaner per hour" cents={4500} onCents={() => undefined} />);
    expect(html).toContain("45.00");
    expect(html).toContain("per cleaner per hour");
    expect(html).toMatch(/aria-describedby="[^"]+-unit"/);
  });

  it("shows each line with its reason, the unit, and the total as their sum", () => {
    const result = quote(spec(), { addOns: [{ id: "oven-extra", quantity: 1 }] });
    const html = renderToStaticMarkup(<QuoteLines result={result} showOrder />);
    expect(html).toContain("$150.00");
    expect(html).toContain("per visit");
    expect(html).toContain("Already included in this service, so not charged");
    expect(html).toContain("The order every price is worked out in");
  });

  it("never shows a walkthrough job as a firm price, or as $0", () => {
    const html = renderToStaticMarkup(<QuoteLines result={quote(spec({ pricing: { method: "custom_quote", fromCents: 40000, laborMinutes: null } }), {})} />);
    expect(html).toContain("Walkthrough needed");
    expect(html).toMatch(/>From<\/span><span[^>]*><span class="sr-only">\$400\.00/);
    expect(html).toContain("Starting price");
    const none = renderToStaticMarkup(<QuoteLines result={quote(spec({ pricing: { method: "custom_quote", fromCents: null, laborMinutes: null } }), {})} />);
    expect(none).toContain("Set after a walkthrough");
    expect(none).not.toContain("$0.00");
  });

  it("leads with the total and the price at a glance, with every line one tap away", () => {
    const withExtra = spec({ addOns: [{ id: "fridge", label: "Inside the fridge", priceCents: 2500, per: "visit", laborMinutes: 20, maxQuantity: 1 }] });
    const html = renderToStaticMarkup(<QuoteLines result={quote(withExtra, { addOns: [{ id: "fridge", quantity: 1 }] })} />);
    expect(html).toContain("$175.00");
    expect(html).toContain('aria-label="The price at a glance"');
    expect(html).toMatch(/Base<\/span> \$150\.00/);
    expect(html).toMatch(/Added<\/span> \+\$25\.00/);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>.*How it adds up.*2 lines/);
  });
});

describe("the three preview views", () => {
  it("shows the customer what is and is not included, and an included extra as included", () => {
    const html = renderToStaticMarkup(<CustomerView spec={spec()} result={quote(spec(), {})} />);
    expect(html).toContain("Not included");
    expect(html).toContain("Exterior windows");
    expect(html).toContain("Oven interior: included");
  });

  it("gives the team its checklist by room, with photo markers", () => {
    const html = renderToStaticMarkup(<TeamView spec={spec()} result={quote(spec(), {})} />);
    expect(html).toContain("Kitchen");
    expect(html).toContain("photo");
    expect(html).toContain("all cleaners together");
  });

  it("calls the remainder contribution, never net profit, and lists what was not entered", () => {
    const html = renderToStaticMarkup(<ProfitPanel profit={profitability(quote(spec(), {}), emptyCosts())} />);
    expect(html).toContain("Contribution after direct costs");
    // Nothing is labeled net profit. What contribution, margin and markup mean is one tap away.
    expect(html).not.toMatch(/>\s*net profit/i);
    expect(html).toContain('aria-label="About Contribution after direct costs"');
    expect(html).toContain('aria-label="About Margin"');
    expect(html).toContain('aria-label="About Markup"');
    expect(html).toContain("Not entered");
  });

  it("shows where the price goes as one bar, named in full for screen readers, and the margin as a meter", () => {
    const costs = { ...emptyCosts(), pay: { model: "hourly" as const, hourlyCents: 2000, burdenPercent: 0 }, suppliesPerVisitCents: 500, targetMarginPercent: 40, floorMarginPercent: 25 };
    const profit = profitability(quote(spec(), {}), costs);
    const html = renderToStaticMarkup(<ProfitPanel profit={profit} costs={costs} />);
    expect(html).toMatch(/role="img" aria-label="Where the \$150\.00 goes: Direct costs \$[\d.,]+ \([\d.]+%\), Contribution after direct costs/);
    expect(html).toContain('role="meter"');
    expect(html).toContain("Floor 25% · Target 40%");
    expect(html).toContain("Target price");
  });

  it("puts a margin against the floor and target in words, never by color alone", () => {
    expect(marginStanding(10, 25, 40).words).toBe("Below your 25% floor");
    expect(marginStanding(30, 25, 40).words).toBe("Under your 40% target");
    expect(marginStanding(45, 25, 40).words).toBe("At or above your 40% target");
    expect(marginStanding(-5, null, null).words).toBe("Costs are more than the price");
    expect(marginStanding(45, null, null).words).toBe("No target margin set");
  });
});

describe("explanations wait behind a tip", () => {
  it("names the tip for what it explains and keeps the explanation out of the page until asked", () => {
    const html = renderToStaticMarkup(<InfoTip label="Rush">Short-notice bookings.</InfoTip>);
    expect(html).toContain('aria-label="About Rush"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Short-notice bookings.");
  });

  it("keeps the tip outside the label, so the input keeps its own name", () => {
    const html = renderToStaticMarkup(<MoneyInput label="Minimum charge" unit="per visit" cents={null} onCents={() => undefined} tip="Applied after discounts." />);
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Minimum charge<\/label><button[^>]*aria-label="About Minimum charge"/);
  });
});

describe("pricing shown, not described", () => {
  const edit = () => undefined;

  it("offers the common methods as cards with an example, and the rest one tap away", () => {
    const html = renderToStaticMarkup(<PricingStep spec={spec()} edit={edit} disabled={false} />);
    expect(html).toContain("Fixed price");
    expect(html).toContain("e.g. $150 a visit");
    expect(html).toContain("More ways to price (5)");
    expect(html).not.toContain("Recurring package");
    expect(html).toMatch(/aria-expanded="false"[^>]*>More ways to price/);
  });

  it("shows the selected method even when it is not a common one", () => {
    const html = renderToStaticMarkup(<PricingStep spec={spec({ pricing: { method: "custom_quote", fromCents: null, laborMinutes: null } })} edit={edit} disabled={false} />);
    expect(html).toContain("Custom quote");
    expect(html).toContain("Fewer ways to price");
  });

  it("works out a usual job from what is typed", () => {
    const hourly = spec({ pricing: { method: "hourly_per_cleaner", rateCents: 4500, minimumHours: 2, incrementMinutes: 30, estimatedLaborMinutes: 240 } });
    const html = renderToStaticMarkup(<PricingStep spec={hourly} edit={edit} disabled={false} />);
    expect(html).toContain("A usual job");
    expect(html).toMatch(/4 cleaner-hours \(\d cleaners?\) × \$45\.00 per cleaner per hour<\/span><span[^>]*>= \$180\.00/);
  });

  it("shows each adjustment as a switch, with what it does when on", () => {
    const base = spec();
    const on = { ...base, modifiers: { ...base.modifiers, rush: { enabled: true, adjustment: { kind: "percent" as const, value: 25 } } } };
    const html = renderToStaticMarkup(<ExtrasStep spec={on} edit={edit} disabled={false} />);
    expect(html).toMatch(/id="([^"]+)-title"[^>]*>Rush<\/span>/);
    expect(html).toMatch(/role="switch" aria-checked="true" aria-labelledby="[^"]+-title"/);
    expect(html).toContain("+25%");
    expect(html).toContain("Off: prices never change with demand");
    expect(html).toContain('aria-label="About Demand pricing"');
  });
});

describe("phase two: less to scan", () => {
  const edit = () => undefined;

  it("folds each extra into a row with its price, or Included when the service already covers it", () => {
    const html = renderToStaticMarkup(<ExtrasStep spec={spec({ addOns: [{ id: "oven-extra", label: "Oven interior", priceCents: 3500, per: "visit", laborMinutes: 30, maxQuantity: 1, coversItemId: "oven" }, { id: "fridge", label: "Inside the fridge", priceCents: 3500, per: "visit", laborMinutes: 30, maxQuantity: 1 }] })} edit={edit} disabled={false} />);
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*?Inside the fridge.*?\$35\.00 per visit/);
    expect(html).toMatch(/Oven interior.*?>Included</);
    expect(html).not.toContain(">Already included as<");
  });

  it("counts the way to a first live service, and says what is next", () => {
    const steps = setupSteps(catalog({ setupDone: true, services: [{ id: "a", key: "a", name: "A", category: "residential", status: "draft", origin: "manual", live: null, draft: { revision: 1, updatedAt: 1, by: "Dana", step: "basics", name: "A", summary: "", illustrative: false, blockers: 0 }, openChange: null }] }) as never);
    expect(steps.map((s) => s.done)).toEqual([true, true, false, false]);
    data["services:catalog"] = catalog({ setupDone: false });
    const html = render("owner", <ServicesHome />);
    expect(html).toContain('aria-label="0 of 4 done"');
    expect(html).toContain("next: tell Selestial your costs");
  });

  it("draws comparable prices on one line, named in full, with the company's starting price marked", () => {
    const html = renderToStaticMarkup(<PriceStrip points={[{ key: "a", cents: 12900, label: "North" }, { key: "b", cents: 14500, label: "East" }, { key: "c", cents: 16900, label: "South" }]} low={12900} high={16900} unit="per visit" kind="Advertised starting prices" mine={{ cents: 13500, label: "Your starting price" }} />);
    expect(html).toContain('aria-label="Advertised starting prices per visit: $129.00, $145.00, $169.00. Range $129.00 to $169.00. Your starting price: $135.00."');
    expect(html).toContain("Your starting price $135.00");
  });

  it("lists the prices still the template's on the Review step, each with a way to change it", () => {
    const standard = TEMPLATES.find((t) => t.id === "res-standard")!.spec;
    data["services:service"] = {
      service: { id: "svc1", key: "standard-clean", name: "Standard clean", category: "residential", status: "draft", origin: "template", templateId: "res-standard", publishedVersion: null, publishedAt: null },
      live: null,
      draft: { spec: { ...standard, illustrative: true }, revision: 1, baseVersion: null, step: "review", updatedAt: 1, by: "Dana", rollbackOf: null },
      versions: [],
      changes: [],
      canDraft: true,
      canPublish: true,
    };
    data["services:profile"] = { costs: emptyCosts() };
    const html = render("owner", <ServiceBuilder serviceId="svc1" />);
    expect(html).toContain('aria-label="Prices still from the template"');
    expect(html).toMatch(/Base price <span[^>]*>\$120\.00/);
    expect(html).toContain("Change in Pricing");
    expect(html).toContain("These prices are right for my market");
    expect(html).toMatch(/\d+ prices are still the template&#x27;s example/);
  });

  it("marks steps with nothing to fix, and shows phone progress", () => {
    data["services:service"] = {
      service: { id: "svc1", key: "standard-clean", name: "Standard clean", category: "residential", status: "draft", origin: "manual", templateId: null, publishedVersion: null, publishedAt: null },
      live: null,
      draft: { spec: spec(), revision: 1, baseVersion: null, step: "pricing", updatedAt: 1, by: "Dana", rollbackOf: null },
      versions: [],
      changes: [],
      canDraft: true,
      canPublish: true,
    };
    data["services:profile"] = { costs: emptyCosts() };
    const html = render("owner", <ServiceBuilder serviceId="svc1" />);
    expect(html).toContain('Basics</span><span class="sr-only">, nothing to fix</span>');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuetext="Step 3 of 6: Pricing"/);
  });
});

describe("research starts with a question box, like Chat", () => {
  const briefs = (over: Record<string, unknown> = {}) => ({ canStart: true, briefs: [], ...over });
  const profile = { costs: emptyCosts(), context: { serviceAreas: "Austin, TX" } };

  it("opens with a box to ask in, what it will use, and ideas to start from", () => {
    data["servicesResearch:briefs"] = briefs();
    data["services:profile"] = profile;
    data["services:catalog"] = catalog();
    const html = render("owner", <ResearchHome />);
    expect(html).toContain("What do you want to find out?");
    expect(html).toMatch(/<label[^>]*class="sr-only"[^>]*>Ask a research question<\/label><textarea/);
    expect(html).toContain("This research will use:");
    expect(html).toContain("Austin, TX");
    expect(html).toContain("Your completed visits · free");
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Web research · 10 credits/);
    expect(html).toContain('aria-label="Start research (10 credits)"');
    expect(html).toContain("What do cleaning businesses near Austin, TX publish for a standard home clean?");
    expect(html).not.toContain("New research");
  });

  it("shows Office the briefs, with no box to start one", () => {
    data["servicesResearch:briefs"] = briefs({ canStart: false, briefs: [{ id: "b1", question: "What do businesses near Austin charge?", geography: "Austin", origin: "member", mode: "web", state: "ready", blocked: null, findings: 4, createdAt: 1, finishedAt: 2 }] });
    data["services:profile"] = profile;
    const html = render("office", <ResearchHome />);
    expect(html).not.toContain("Ask a research question");
    expect(html).toContain("What do businesses near Austin charge?");
  });
});

describe("controls a keyboard can reach", () => {
  it("draws switches as switches, with their state in words", () => {
    const html = renderToStaticMarkup(<Toggle label="Demand pricing" checked={false} onChange={() => undefined} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Off");
  });

  it("names both stepper buttons", () => {
    const html = renderToStaticMarkup(<Stepper label="Bedrooms" value={2} onValue={() => undefined} />);
    expect(html).toContain('aria-label="Fewer: Bedrooms"');
    expect(html).toContain('aria-label="More: Bedrooms"');
  });
});

describe("the builder and review", () => {
  const view = (over: Record<string, unknown> = {}) => ({
    service: { id: "svc1", key: "standard-clean", name: "Standard clean", category: "residential", status: "draft", origin: "manual", templateId: null, publishedVersion: null, publishedAt: null },
    live: null,
    draft: { spec: spec({ illustrative: true }), revision: 3, baseVersion: null, step: "pricing", updatedAt: Date.UTC(2027, 2, 1), by: "Selestial, asked by Dana in Chat", rollbackOf: null },
    versions: [],
    changes: [],
    canDraft: true,
    canPublish: true,
    ...over,
  });

  it("reopens a draft at the step it was left on, with the steps in order", () => {
    data["services:service"] = view();
    data["services:profile"] = { costs: emptyCosts() };
    const html = render("owner", <ServiceBuilder serviceId="svc1" />);
    expect(html.indexOf("Basics")).toBeLessThan(html.indexOf("Time &amp; Team"));
    expect(html).toMatch(/aria-current="step"[^>]*>.*?Pricing/);
    expect(html).toContain("Illustrative amounts");
    expect(html).toContain("Draft saved");
  });

  it("shows a manager that only the Owner approves, with no approve button", () => {
    data["services:change"] = changeFixture();
    const html = render("manager", <ChangeReview changeId="c1" />);
    expect(html).toContain("Only the Owner approves and publishes price changes");
    expect(html).not.toContain("Approve and publish");
    expect(html).toContain("Set the default crew to 2");
    expect(html).toContain("They describe the price, not how customers will respond");
  });

  const changeFixture = () => ({
      id: "c1",
      service: { id: "svc1", name: "Standard clean", status: "draft", liveVersion: null },
      kind: "publish",
      state: "in_review",
      hash: "h",
      title: "Add Standard clean",
      reason: "New.",
      evidence: [],
      agentNotes: [{ agent: "dispatch", status: "concern", title: "Dispatch: timing or staffing may not hold", detail: "Too long.", suggestion: { label: "Set the default crew to 2", field: "team.crewSize", value: 2 } }],
      impact: ["Booked visits keep their price."],
      customerNotice: { required: false, note: "" },
      contractReview: { required: false, note: "" },
      effectiveAt: null,
      submittedAt: 1,
      submittedBy: "Dana",
      approval: null,
      publishedAt: null,
      publishedBy: null,
      closedReason: null,
      version: 1,
      fromVersion: null,
      after: spec(),
      before: null,
      changesInWords: ["New service: Standard clean."],
      prices: [{ label: "A usual visit", before: null, after: 15000 }],
      liveMoved: false,
      draftMoved: false,
      canPublish: false,
      canWithdraw: true,
  });

  it("shows what changes as old and new, and folds away prices that stay the same", () => {
    data["services:change"] = {
      ...changeFixture(),
      changesInWords: ["Price: $150.00 per visit → $165.00 per visit.", "The customer description changed."],
      prices: [
        { label: "A small home", before: 15000, after: 16500 },
        { label: "A large home", before: 22000, after: 22000 },
      ],
      canPublish: true,
    };
    const html = render("owner", <ChangeReview changeId="c1" />);
    expect(html).toMatch(/line-through[^>]*><span class="sr-only">was <\/span>\$150\.00 per visit/);
    expect(html).toContain("The customer description changed.");
    expect(html).toContain("+$15.00 (+10%)");
    expect(html).toContain("1 example job priced the same");
    expect(html).toContain("Approves exactly this version 1, nothing else");
    expect(html).toContain("Booked visits and signed agreements keep their price");
  });

  it("reads a change line as its label, old value and new value", () => {
    expect(beforeAfter("Default crew: 1 → 2.")).toEqual({ label: "Default crew", before: "1", after: "2" });
    expect(beforeAfter("Rush switched on.")).toBeNull();
  });
});
