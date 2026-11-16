import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyProvider, type Role } from "@/components/app/company";
import { SETTINGS_SECTIONS, sectionsFor } from "@/lib/app/settings";

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
vi.mock("next/navigation", () => ({ usePathname: () => "/app/settings/business", useRouter: () => ({ replace: () => undefined }) }));

const { BusinessDraftProvider } = await import("@/components/app/settings/business-draft");
const { BusinessSection, ServicesSection } = await import("@/components/app/settings/business-sections");
const { PlanBilling } = await import("@/components/app/settings/billing");
const { OverviewGrid } = await import("@/components/app/settings/overview");
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
    expect(html).not.toContain("Only the Owner changes these");
    expect(html).not.toMatch(/<input[^>]*disabled=""[^>]*value="Elm Cleaning"/);
  });

  it("shows everyone else the same values, read only", () => {
    data["settings:business"] = business({ canEdit: false });
    const html = page("office", <BusinessSection />);
    expect(html).toContain("Elm Cleaning");
    expect(html).toContain("Only the Owner changes these");
    expect(html).not.toContain("Save changes");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="Elm Cleaning"/);
    expect(html).toContain("Monday: 8:00 AM to 5:00 PM");
  });

  it("says empty hours are no limit, not closed", () => {
    data["settings:business"] = business({ hours: [], serviceAreas: [], configured: false });
    const html = page("owner", <BusinessSection />);
    expect(html).toContain("No hours set. Visits can be booked at any time.");
    expect(html).toContain("not closed");
  });

  it("explains an empty service catalog instead of showing a blank list", () => {
    data["settings:business"] = business();
    const html = page("owner", <ServicesSection />);
    expect(html).toContain("No services yet");
    expect(html).toContain("Add a service");
    const readOnly = page("manager", <ServicesSection />);
    expect(readOnly).toContain("No services yet");
  });

  it("lists saved services with their archived state", () => {
    data["settings:business"] = business({ services: [{ id: "deep-clean", name: "Deep clean", scope: "Everything", durationMinutes: 240, defaultCrew: 2, skills: ["deep"], startingPriceCents: 28000, status: "archived" }] });
    const html = page("owner", <ServicesSection />);
    expect(html).toContain("Deep clean");
    expect(html).toContain("Archived");
    expect(html).toContain("280.00");
    expect(html).toContain("Restore");
  });
});

describe("plan and billing", () => {
  it("never asks the server for billing unless the person is the Owner", () => {
    data["settings:billing"] = { activePlan: null, status: "not_started", plans: [], notes: [] };
    for (const role of ["manager", "office"] as const) {
      const html = renderToStaticMarkup(
        <CompanyProvider company={{ companyId, name: "Elm", timezone: "UTC", role }}>
          <PlanBilling />
        </CompanyProvider>,
      );
      expect(html).toContain("is for the Owner");
    }
    const asked = calls.filter((call) => call.name === "settings:billing");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((call) => call.args === "skip")).toBe(true);
  });

  it("shows the Owner the two plans and no purchase control", () => {
    data["settings:billing"] = {
      activePlan: null,
      status: "not_started",
      plans: [
        { id: "growth", name: "Growth", monthlyCents: 29900, includes: ["All eight agents, as each is released"] },
        { id: "scale", name: "Scale", monthlyCents: 49900, includes: ["Customer portal access, when it is available"] },
      ],
      notes: ["Usage limits are not set yet."],
    };
    const html = renderToStaticMarkup(
      <CompanyProvider company={{ companyId, name: "Elm", timezone: "UTC", role: "owner" }}>
        <PlanBilling />
      </CompanyProvider>,
    );
    expect(html).toContain("$299<");
    expect(html).toContain("$499<");
    expect(html).toContain("No plan has been started");
    expect(html).not.toMatch(/<button|Subscribe|Buy|Upgrade|Checkout/i);
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
    expect(SETTINGS_SECTIONS).toHaveLength(13);
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
    const html = renderToStaticMarkup(<SettingsNavList sections={SETTINGS_SECTIONS} activePath="/app/settings/services" />);
    expect(html).toMatch(/href="\/app\/settings\/services"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/app\/settings\/services"/);
    expect(renderToStaticMarkup(<SettingsNavList sections={[]} activePath="/" />)).toContain("Nothing in Settings matches");
  });
});

describe("when a part of Settings cannot load", () => {
  it("says what is likely wrong instead of leaving a blank page", async () => {
    const { Unavailable } = await import("@/components/app/settings/guard");
    const html = renderToStaticMarkup(<Unavailable error={new Error("Could not find public function for 'settings:business'\nstack...")} />);
    expect(html).toContain("could not load");
    expect(html).toContain("Deploy the latest Convex functions");
    expect(html).toContain("Could not find public function for &#x27;settings:business&#x27;");
    expect(html).not.toContain("stack...");
  });
});
