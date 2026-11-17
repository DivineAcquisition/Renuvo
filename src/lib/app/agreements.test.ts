import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AGREEMENT_PAGES, NAV_ITEMS } from "./navigation";
import { AGREEMENT_TABS, isoDay, READINESS, SORTS, VIEW_HINT, WORKFLOW, WORKFLOW_ORDER } from "./agreements";
import { sectionById } from "./settings";

const root = process.cwd();
const pageFile = (route: string) => path.join(root, "src/app/(product)", route, "page.tsx");

describe("Agreements in the navigation", () => {
  it("is a company destination, with a page for every section, and Selestial's own terms kept under Settings", () => {
    const item = NAV_ITEMS.find((i) => i.id === "agreements")!;
    expect(item).toMatchObject({ label: "Agreements", section: "shared", path: "/app/agreements", minimumRole: "office" });
    expect(item.availability.status).toBe("live");
    for (const tab of AGREEMENT_TABS) expect(existsSync(pageFile(tab.href)), tab.href).toBe(true);
    for (const page of AGREEMENT_PAGES) expect(existsSync(pageFile(page.path)), page.path).toBe(true);
    expect(sectionById("agreements")?.label).toBe("Selestial terms");
    expect(sectionById("agreements")?.purpose).toMatch(/Selestial terms your company has accepted/);
  });

  it("words states and readiness consistently", () => {
    expect(Object.keys(WORKFLOW)).toEqual(["draft", "needs_review", "approved", "sent", "partially_signed", "signed", "declined", "withdrawn", "expired", "delivery_failed"]);
    expect(WORKFLOW_ORDER.every((s) => s in WORKFLOW)).toBe(true);
    expect(Object.keys(READINESS)).toEqual(["template", "starting_draft", "specialist_review"]);
    expect(Object.keys(VIEW_HINT)).toHaveLength(7);
    expect(SORTS.map((s) => s.id)).toContain("renewal");
    expect(isoDay("2027-03-15")).toBe("Mar 15, 2027");
    expect(isoDay(null)).toBe("—");
  });
});
