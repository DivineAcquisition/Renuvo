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
const { ChangeReview } = await import("./changes");
const { QuoteLines, ProfitPanel, CustomerView, TeamView } = await import("./preview");
const { MoneyInput, Toggle, Stepper } = await import("./shared");

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

  it("never shows a walkthrough job as a firm price", () => {
    const html = renderToStaticMarkup(<QuoteLines result={quote(spec({ pricing: { method: "custom_quote", fromCents: 40000, laborMinutes: null } }), {})} />);
    expect(html).toContain("Walkthrough needed");
    expect(html).toContain("Starting price");
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
    // Nothing is labeled net profit; the only mention says what contribution is not.
    expect(html).not.toMatch(/>\s*net profit/i);
    expect(html).toContain("It is not net profit");
    expect(html).toContain("Not entered");
    expect(html).toContain("A 50% markup is a 33.3% margin");
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
    data["services:change"] = {
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
    };
    const html = render("manager", <ChangeReview changeId="c1" />);
    expect(html).toContain("Only the Owner approves and publishes price changes");
    expect(html).not.toContain("Approve and publish");
    expect(html).toContain("Set the default crew to 2");
    expect(html).toContain("They describe the price, not how customers will respond");
  });
});
