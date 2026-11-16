import { describe, expect, it } from "vitest";

import { SETTINGS_PAGES } from "./navigation";
import { legacyTarget, mayOpen, searchSections, sectionById, sectionForPath, SETTINGS_SECTIONS, sectionsFor } from "./settings";
import { blankService, draftFrom, hoursSummary, isDirty, leavesSettings, localProblems, parseDollars, payloadFrom, type SavedBusiness } from "./settings-draft";

const saved: SavedBusiness = {
  revision: 2,
  name: "Elm",
  timezone: "America/Chicago",
  serviceAreas: ["78701", "78702"],
  hours: [{ weekday: 1, startMinute: 480, endMinute: 1020 }],
  services: [{ id: "std-clean", name: "Standard", scope: "All", durationMinutes: 120, defaultCrew: 1, skills: ["standard"], startingPriceCents: 15000, status: "active" }],
};

describe("the settings catalog", () => {
  it("is the one source of the navigation's settings destinations", () => {
    expect(SETTINGS_PAGES.map((page) => page.path)).toEqual(SETTINGS_SECTIONS.map((section) => section.path));
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it("limits billing and the activity log to the Owner", () => {
    expect(sectionsFor("owner")).toHaveLength(SETTINGS_SECTIONS.length);
    for (const role of ["manager", "office"] as const) {
      const ids = sectionsFor(role).map((section) => section.id);
      expect(ids).not.toContain("billing");
      expect(ids).not.toContain("activity");
      expect(mayOpen(sectionById("billing")!, role)).toBe(false);
    }
  });

  it("finds a section by what people call it", () => {
    expect(searchSections("zip").map((s) => s.id)).toContain("business");
    expect(searchSections("2fa").map((s) => s.id)).toEqual(["security"]);
    expect(searchSections("audit log").map((s) => s.id)).toEqual(["activity"]);
    expect(searchSections("")).toHaveLength(SETTINGS_SECTIONS.length);
    expect(searchSections("zzzz")).toEqual([]);
  });

  it("maps a path, and an old hash link, to the page that holds it now", () => {
    expect(sectionForPath("/app/settings/services?x=1")?.id).toBe("services");
    expect(sectionForPath("/app/settings")).toBeUndefined();
    expect(legacyTarget("#security")).toBe("/app/settings/security");
    expect(legacyTarget("#agents")).toBe("/app/settings/agents");
    expect(legacyTarget("#nonsense")).toBeNull();
    expect(legacyTarget("")).toBeNull();
  });
});

describe("the business draft", () => {
  it("round trips the saved record, and is clean until something changes", () => {
    const draft = draftFrom(saved);
    expect(isDirty(draft, saved)).toBe(false);
    expect(draft.areas).toBe("78701, 78702");
    expect(draft.services[0].price).toBe("150.00");
    expect(isDirty({ ...draft, name: "Elm & Co" }, saved)).toBe(true);
    expect(payloadFrom(draft)).toMatchObject({ serviceAreas: ["78701", "78702"], services: [{ id: "std-clean", durationMinutes: 120, startingPriceCents: 15000, skills: ["standard"] }] });
  });

  it("reads dollars exactly and refuses what is not an amount", () => {
    expect(parseDollars("$1,200.5")).toBe(120050);
    expect(parseDollars("0")).toBe(0);
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("-4")).toBeNull();
    const draft = draftFrom(saved);
    draft.services[0] = { ...draft.services[0], price: "lots", duration: "two hours" };
    expect(localProblems(draft)).toHaveLength(2);
    expect(Number.isNaN(payloadFrom(draft).services[0].durationMinutes)).toBe(true);
  });

  it("gives a new service its own stable id", () => {
    const [a, b] = [blankService(() => 0.1), blankService(() => 0.9)];
    expect(a.id).toMatch(/^svc-[a-z0-9]+$/);
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe("active");
  });

  it("reads hours as plain lines", () => {
    expect(hoursSummary([{ weekday: 2, startMinute: 540, endMinute: 780 }, { weekday: 2, startMinute: 840, endMinute: 1020 }])).toEqual(["Tuesday: 9:00 AM to 1:00 PM, 2:00 PM to 5:00 PM"]);
    expect(hoursSummary([])).toEqual([]);
  });
});

describe("the unsaved-changes warning", () => {
  const here = { pathname: "/app/settings/business", search: "" };
  const origin = "https://app.example.com";
  it("asks when a link leaves Settings and stays quiet moving within it", () => {
    expect(leavesSettings("/app/customers", origin, here)).toBe(true);
    expect(leavesSettings("https://elsewhere.example/", origin, here)).toBe(true);
    expect(leavesSettings("/app/settings/services", origin, here)).toBe(false);
    expect(leavesSettings("/app/settings", origin, here)).toBe(false);
    expect(leavesSettings("/app/settings/business#hours", origin, here)).toBe(false);
    expect(leavesSettings("not a url", "", here)).toBe(false);
  });
});

describe("recruiting rules form", () => {
  it("names the common mistakes before anything is sent", async () => {
    const { formFrom, recruitingProblems } = await import("./recruiting-form");
    const base = formFrom({ invitationMode: "review", followUpHours: [48, 120], maxFollowUps: 2, sendFromMinute: 540, sendUntilMinute: 1080, sendDays: [1, 2], fromName: "Hiring", replyTo: null, linkTtlDays: 14, offerTtlDays: 7, retentionDays: 365, interviewMinutes: 30, interviewReminderHours: 24, decideWithinHours: 48, onboardingRequirements: [{ key: "agreement", label: "Agreement" }], recruitingRules: null, communicationPolicy: null, escalationRules: null });
    expect(recruitingProblems(base)).toEqual([]);
    expect(recruitingProblems({ ...base, followUpHours: "48, 48" }).join(" ")).toMatch(/same time/);
    expect(recruitingProblems({ ...base, sendFrom: "18:00", sendUntil: "09:00" }).join(" ")).toMatch(/end after they start/);
    expect(recruitingProblems({ ...base, requirements: [] }).join(" ")).toMatch(/at least one/);
    expect(recruitingProblems({ ...base, sendDays: [] }).join(" ")).toMatch(/at least one day/);
    expect(recruitingProblems({ ...base, maxFollowUps: "3" }).join(" ")).toMatch(/cannot be more/);
  });
});
