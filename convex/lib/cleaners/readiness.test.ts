import { describe, expect, it } from "vitest";

import { conflictsOf, weekSummary } from "./attention";
import { matchesFor } from "./duplicates";
import { readiness, type ReadinessFacts, type RequirementRow } from "./readiness";
import { DEFAULT_DEFINITIONS, definitionsOf, type Definition } from "./settings";

const NOW = Date.UTC(2027, 2, 1, 12);
const DAY = 24 * 60 * 60 * 1000;
const facts = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({ status: "ready", engagement: "contractor", weeklyWindows: 3, serviceAreas: 2, agreements: [], ...over });
const all = (status: RequirementRow["status"]): RequirementRow[] => DEFAULT_DEFINITIONS.map((def) => ({ key: def.key, status }));

describe("readiness", () => {
  it("is ready only when active and every assignment-blocking requirement is met", () => {
    const rows = all("accepted").map((row) => (row.key === "agreement" ? { key: "agreement", status: "not_started" as const } : row));
    const answer = readiness({ definitions: DEFAULT_DEFINITIONS, rows, facts: facts(), now: NOW });
    expect(answer.state).toBe("blocked");
    expect(answer.eligible).toBe(false);
    expect(answer.blockers.map((view) => view.key)).toEqual(["agreement"]);
    expect(answer.summary).toContain("working agreement");
  });

  it("never counts a submission as met: an upload is not a verification", () => {
    const rows = all("accepted").map((row) => (row.key === "documents" ? { key: "documents", status: "submitted" as const } : row));
    const answer = readiness({ definitions: DEFAULT_DEFINITIONS, rows, facts: facts({ agreements: [{ docType: "*", state: "signed" }] }), now: NOW });
    expect(answer.blockers.map((view) => view.key)).toEqual(["documents"]);
  });

  it("reads availability, areas and signed agreements from the record, and a sent agreement is not signed", () => {
    const rows = all("not_started").map((row) => (["contact", "documents", "policies"].includes(row.key) ? { ...row, status: "accepted" as const } : row));
    const withWildcard = DEFAULT_DEFINITIONS.map((def) => (def.kind === "agreement" ? { ...def, agreementDocType: "*" } : def));
    const sent = readiness({ definitions: withWildcard, rows, facts: facts({ agreements: [{ docType: "*", state: "sent" }] }), now: NOW });
    expect(sent.blockers.map((view) => view.key)).toEqual(["agreement"]);
    expect(sent.requirements.find((view) => view.key === "agreement")?.state).toBe("submitted");
    const signed = readiness({ definitions: withWildcard, rows, facts: facts({ agreements: [{ docType: "*", state: "signed" }] }), now: NOW });
    expect(signed.state).toBe("ready");
    const noHours = readiness({ definitions: withWildcard, rows, facts: facts({ weeklyWindows: 0, agreements: [{ docType: "*", state: "signed" }] }), now: NOW });
    expect(noHours.blockers.map((view) => view.key)).toEqual(["availability"]);
  });

  it("treats an accepted requirement past its expiry as expired, and warns before", () => {
    const definitions: Definition[] = [{ ...DEFAULT_DEFINITIONS[2], validForDays: 365 }];
    const expired = readiness({ definitions, rows: [{ key: "documents", status: "accepted", expiresAt: NOW - 1 }], facts: facts(), now: NOW });
    expect(expired.blockers[0].state).toBe("expired");
    const soon = readiness({ definitions, rows: [{ key: "documents", status: "accepted", expiresAt: NOW + 5 * DAY }], facts: facts(), now: NOW, warningDays: 30 });
    expect(soon.eligible).toBe(true);
    expect(soon.requirements[0].expiringSoon).toBe(true);
  });

  it("does not block people who were never given a requirement", () => {
    const answer = readiness({ definitions: DEFAULT_DEFINITIONS, rows: [], facts: facts(), now: NOW });
    expect(answer.state).toBe("ready");
    expect(answer.progress).toEqual({ met: 0, total: 0 });
  });

  it("keeps engagement status apart from readiness", () => {
    for (const status of ["paused", "suspended", "ended"] as const) expect(readiness({ definitions: DEFAULT_DEFINITIONS, rows: all("accepted"), facts: facts({ status }), now: NOW }).state).toBe("not_active");
    const onboarding = readiness({ definitions: DEFAULT_DEFINITIONS, rows: all("accepted"), facts: facts({ status: "onboarding", agreements: [{ docType: "agreement", state: "signed" }] }), now: NOW });
    expect(onboarding.state).toBe("onboarding");
    expect(onboarding.eligible).toBe(false);
  });

  it("holds a service-specific requirement against that service only, and crew equipment against no one", () => {
    const definitions: Definition[] = [
      { ...DEFAULT_DEFINITIONS[0] },
      { key: "floor_machine", label: "Floor machine training", kind: "training", effect: "blocks_assignments", appliesTo: ["contractor"], reviewer: "manager", forServices: ["commercial"], cleanerCompletes: false, order: 1, isDefault: false },
      { key: "van_kit", label: "Crew van kit", kind: "equipment", effect: "blocks_assignments", appliesTo: ["contractor"], reviewer: "manager", providedBy: "crew", forServices: [], cleanerCompletes: false, order: 2, isDefault: false },
    ];
    const rows: RequirementRow[] = [{ key: "contact", status: "accepted" }, { key: "floor_machine", status: "not_started" }, { key: "van_kit", status: "not_started" }];
    const general = readiness({ definitions, rows, facts: facts(), now: NOW });
    expect(general.state).toBe("ready");
    expect(general.serviceBlockers.map((view) => view.key)).toEqual(["floor_machine"]);
    const commercial = readiness({ definitions, rows, facts: facts(), now: NOW, service: { name: "Commercial", skills: [] } });
    expect(commercial.blockers.map((view) => view.key)).toEqual(["floor_machine"]);
    const home = readiness({ definitions, rows, facts: facts(), now: NOW, service: { name: "Standard clean", skills: [] } });
    expect(home.blockers).toEqual([]);
  });

  it("keeps a company's own Recruiter onboarding list as its template", () => {
    const defs = definitionsOf({ name: "A", recruiter: { onboardingRequirements: [{ key: "background", label: "Background check recorded" }, { key: "agreement", label: "Agreement signed" }] } }, []);
    expect(defs.map((def) => def.key)).toEqual(["contact", "agreement", "availability", "service_areas", "background"]);
    expect(defs.find((def) => def.key === "agreement")?.label).toBe("Agreement signed");
  });
});

describe("conflicts and summaries", () => {
  const tz = "America/Chicago";
  // Tuesday March 2, 2027, 10:00-12:00 Chicago.
  const job = { jobId: "j1", assignmentId: "a1", startsAt: Date.UTC(2027, 2, 2, 16), endsAt: Date.UTC(2027, 2, 2, 18), label: "Standard clean", status: "accepted" as const };
  const tuesday = [{ weekday: 2, startMinute: 8 * 60, endMinute: 17 * 60 }];

  it("finds accepted work that overlaps time away, falls outside the hours given, or overlaps other work", () => {
    expect(conflictsOf({ commitments: [job], absences: [], windows: tuesday, timezone: tz })).toEqual([]);
    expect(conflictsOf({ commitments: [job], absences: [{ kind: "time_off", span: { startsAt: job.startsAt - 1, endsAt: job.endsAt } }], windows: tuesday, timezone: tz })[0].reason).toContain("time away");
    expect(conflictsOf({ commitments: [job], absences: [], windows: [{ weekday: 3, startMinute: 0, endMinute: 1440 }], timezone: tz })[0].reason).toContain("outside");
    const second = { ...job, jobId: "j2", assignmentId: "a2", startsAt: job.startsAt + 30 * 60_000 };
    expect(conflictsOf({ commitments: [job, second], absences: [], windows: tuesday, timezone: tz }).map((row) => row.commitment.assignmentId)).toEqual(["a2"]);
    // An offer that was not accepted is not a conflict: nothing is committed yet.
    expect(conflictsOf({ commitments: [{ ...job, status: "offered" }], absences: [{ kind: "time_off", span: { startsAt: 0, endsAt: job.endsAt } }], windows: tuesday, timezone: tz })).toEqual([]);
  });

  it("summarises a week as day ranges", () => {
    const days = (list: number[]) => list.map((weekday) => ({ weekday, startMinute: 480, endMinute: 1020 }));
    expect(weekSummary(days([1, 2, 3, 4, 5]))).toBe("Mon–Fri");
    expect(weekSummary(days([1, 3, 6]))).toBe("Mon, Wed, Sat");
    expect(weekSummary([])).toBe("No weekly hours yet");
  });
});

describe("duplicates", () => {
  it("matches by email or phone strongly and by name weakly", () => {
    const existing = [
      { id: "1", name: "Rosa Díaz", phone: "+1 (512) 555-0101" },
      { id: "2", name: "Lena Park", email: "lena@example.com" },
    ];
    expect(matchesFor({ name: "R. Diaz", phone: "512.555.0101" }, existing)).toMatchObject([{ id: "1", strong: true, why: ["phone"] }]);
    expect(matchesFor({ name: "rosa diaz" }, existing)).toMatchObject([{ id: "1", strong: false, why: ["name"] }]);
    expect(matchesFor({ name: "Someone", email: "LENA@example.com " }, existing)).toMatchObject([{ id: "2", strong: true }]);
    expect(matchesFor({ name: "New Person", phone: "5125550199" }, existing)).toEqual([]);
  });
});
