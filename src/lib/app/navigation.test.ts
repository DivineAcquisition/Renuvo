import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_PROFILES, DEPARTMENTS as BACKEND_DEPARTMENTS } from "../../../convex/lib/departments";
import { AGENTS as BACKEND_AGENTS } from "../../../convex/lib/statuses";
import { AGENT_IDS, AGENTS, APP_ROOT, BADGE_KINDS, DEFAULT_DEPARTMENT, DEPARTMENT_IDS, DEPARTMENTS, EXISTING_ROUTES, FOOTER_ITEMS, LANDING_PATH, NAV_ITEMS, PERSISTENT_ITEMS, SHARED_ITEMS, SIDEBAR_SECTIONS, type Badge } from "./navigation";
import {
  activeFor,
  agentsIn,
  allDestinations,
  breadcrumbsFor,
  hrefFor,
  initialSidebarState,
  linkTo,
  mayShow,
  parseSidebarState,
  resolvePath,
  selectDepartment,
  serializeSidebarState,
  sidebarStorageKey,
  syncToPath,
  toggleAgent,
  topBadge,
} from "./navigation-helpers";

// ── The pages that really exist, read from the app directory ────────────────────────────────────────

function pagePatterns(dir: string, segments: string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pagePatterns(full, /^\(.*\)$/.test(name) ? segments : [...segments, name]));
    else if (name === "page.tsx") out.push(`/${segments.join("/")}`);
  }
  return out;
}

const PAGES = pagePatterns(path.join(process.cwd(), "src/app"));
const APP_PAGES = PAGES.filter((pattern) => pattern === APP_ROOT || pattern.startsWith(`${APP_ROOT}/`));

/** True when a concrete path is served by a page pattern such as /app/departments/[department]. */
function served(concrete: string, pattern: string): boolean {
  const [a, b] = [concrete.split("/").filter(Boolean), pattern.split("/").filter(Boolean)];
  if (b.at(-1)?.startsWith("[[...")) return a.length >= b.length - 1 && b.slice(0, -1).every((part, index) => part.startsWith("[") || part === a[index]);
  return a.length === b.length && b.every((part, index) => part.startsWith("[") || part === a[index]);
}
const hasPage = (concrete: string) => PAGES.some((pattern) => served(concrete, pattern));

// ── The structure the owner set. This is the specification; the definition must equal it. ────────────

const SPEC: Record<string, Record<string, string[]>> = {
  Growth: {
    Marketing: ["Campaigns", "Content & Creative", "Promotions", "Lead Sources", "Performance", "Playbook"],
    Sales: ["Pipeline", "Quotes & Proposals", "Follow-ups", "Calls & Messages", "Booking Forms", "Playbook"],
    Retention: ["Recurring Customers", "Customer Health", "Feedback & Reviews", "Recurring Offers", "Win-back", "Referrals", "Playbook"],
  },
  Operations: {
    Dispatch: ["Dispatch Board", "Schedule", "Offers & Coverage", "Live Jobs", "Action Links", "Playbook"],
    Quality: ["Completion Review", "Checklists & Photos", "Service Issues", "Re-cleans", "Playbook"],
    "Customer Care": ["Conversations", "Customer Setup", "Service Requests", "Rescheduling & Cancellations", "Playbook"],
  },
  Team: {
    Recruiter: ["Hiring Needs", "Applicants", "Screening", "Interviews", "Offers & Agreements", "Playbook"],
    "Team Coordinator": ["Onboarding", "Documents & Training", "Readiness", "Availability", "Team Check-ins", "Playbook"],
  },
};

const KEBAB = /^[a-z]+(-[a-z]+)*$/;
const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);

describe("the navigation definition", () => {
  it("has the departments, agents and work tabs the owner set, in that order", () => {
    const built: Record<string, Record<string, string[]>> = {};
    for (const department of DEPARTMENTS) {
      built[department.label] = Object.fromEntries(agentsIn(department.id).map((agent) => [agent.label, agent.tabs.map((tab) => tab.label)]));
    }
    expect(built).toEqual(SPEC);
    // Object equality ignores key order, so the order is checked on its own.
    expect(DEPARTMENTS.map((row) => row.label)).toEqual(Object.keys(SPEC));
    for (const department of DEPARTMENTS) expect(agentsIn(department.id).map((agent) => agent.label)).toEqual(Object.keys(SPEC[department.label]));
    expect(AGENTS).toHaveLength(8);
    expect(SIDEBAR_SECTIONS).toEqual(["business", "departments", "persistent", "agents", "shared", "footer"]);
    expect(PERSISTENT_ITEMS.map((item) => item.label)).toEqual(["Home", "Approvals", "Inbox", "Search"]);
    expect(SHARED_ITEMS.map((item) => item.label)).toEqual(["Customers & Properties", "Cleaners", "Finance", "Reports"]);
    expect(FOOTER_ITEMS.map((item) => item.label)).toEqual(["Settings"]);
  });

  it("uses stable ids that are unique and separate from the labels", () => {
    expect(DEPARTMENTS.map((row) => row.id)).toEqual([...DEPARTMENT_IDS]);
    expect(AGENTS.map((agent) => agent.id)).toEqual([...AGENT_IDS]);
    const ids = [...DEPARTMENT_IDS, ...AGENT_IDS, ...NAV_ITEMS.map((item) => item.id)];
    expect(duplicates(AGENT_IDS.slice())).toEqual([]);
    expect(duplicates(NAV_ITEMS.map((item) => item.id))).toEqual([]);
    // An agent and a company-wide item never share an id. (The Team department and no agent share one either.)
    expect(duplicates([...AGENT_IDS, ...NAV_ITEMS.map((item) => item.id)])).toEqual([]);
    expect(duplicates([...DEPARTMENT_IDS, ...AGENT_IDS])).toEqual([]);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
    for (const agent of AGENTS) {
      expect(duplicates(agent.tabs.map((tab) => tab.id)), agent.id).toEqual([]);
      expect(duplicates(agent.tabs.map((tab) => tab.label)), agent.id).toEqual([]);
      for (const tab of agent.tabs) expect(tab.id, `${agent.id}.${tab.id}`).toMatch(KEBAB);
    }
    expect(duplicates(allDestinations().map((row) => row.id))).toEqual([]);
  });

  it("puts every agent in exactly one real department", () => {
    for (const agent of AGENTS) expect(DEPARTMENT_IDS, agent.id).toContain(agent.department);
    expect(DEPARTMENT_IDS.map((id) => agentsIn(id).map((agent) => agent.id))).toEqual([
      ["marketing", "sales", "retention"],
      ["dispatch", "quality", "customer-care"],
      ["recruiter", "team-coordinator"],
    ]);
    expect(DEPARTMENT_IDS.flatMap((id) => agentsIn(id))).toHaveLength(AGENTS.length);
    expect(DEFAULT_DEPARTMENT).toBe("operations");
    expect(LANDING_PATH).toBe("/app");
  });

  it("keeps the rules every agent's tabs follow", () => {
    for (const agent of AGENTS) {
      // Playbook is last, and conversation with the agent is never a sidebar tab.
      expect(agent.tabs.at(-1), agent.id).toMatchObject({ id: "playbook", label: "Playbook" });
      expect(agent.tabs.filter((tab) => /chat|ask/i.test(tab.label)), agent.id).toEqual([]);
      expect(agent.responsibility.length, agent.id).toBeGreaterThan(10);
    }
    // The two pairs of similar names stay with their owners.
    const owner = (label: string) => AGENTS.filter((agent) => agent.tabs.some((tab) => tab.label === label)).map((agent) => agent.id);
    expect(owner("Customer Setup")).toEqual(["customer-care"]);
    expect(owner("Onboarding")).toEqual(["team-coordinator"]);
    expect(owner("Offers & Agreements")).toEqual(["recruiter"]);
    expect(owner("Offers & Coverage")).toEqual(["dispatch"]);
    // Availability appears under Team Coordinator as a tab, and the cleaner records it reads are the shared ones.
    expect(owner("Availability")).toEqual(["team-coordinator"]);
  });

  it("gives every destination one path of its own, with no conflicts", () => {
    const all = allDestinations();
    expect(duplicates(all.map((row) => row.destination.path))).toEqual([]);
    for (const { id, destination } of all) {
      expect(destination.path === APP_ROOT || destination.path.startsWith(`${APP_ROOT}/`), id).toBe(true);
      expect(destination.path, id).not.toMatch(/\/$|\s|[A-Z]/);
    }
    for (const agent of AGENTS) {
      expect(agent.overview.path).toBe(`/app/agents/${agent.id}`);
      for (const tab of agent.tabs) expect(tab.path).toBe(`/app/agents/${agent.id}/${tab.id}`);
    }
    // No company-wide item sits inside the space reserved for agents, and none shadows another.
    for (const item of NAV_ITEMS) {
      expect(item.path.startsWith("/app/agents"), item.id).toBe(false);
      for (const other of NAV_ITEMS) if (other !== item && item.path !== APP_ROOT) expect(other.path.startsWith(`${item.path}/`), `${other.id} under ${item.id}`).toBe(false);
    }
    // A page that stands in for a destination is an existing page, never another destination's own path.
    const own = new Set(all.map((row) => row.destination.path));
    for (const { id, destination } of all) {
      if (destination.availability.status === "interim") expect(own.has(destination.availability.servedBy), id).toBe(false);
    }
  });
});

describe("what is available today", () => {
  it("claims a destination is live only when its page exists, and never links to a missing page", () => {
    for (const { id, destination } of allDestinations()) {
      const { availability } = destination;
      if (availability.status === "live") {
        expect(hasPage(destination.path), `${id} is marked live`).toBe(true);
      } else if (availability.status === "interim") {
        expect(hasPage(destination.path), `${id} has its own page now; mark it live`).toBe(false);
        expect(hasPage(availability.servedBy), `${id} is served by ${availability.servedBy}`).toBe(true);
        expect(availability.missing.length, id).toBeGreaterThan(20);
      } else {
        expect(hasPage(destination.path), `${id} is planned${availability.notice ? " with a notice page" : "; a page now exists, so update its availability"}`).toBe(Boolean(availability.notice));
      }
      const href = hrefFor(destination);
      if (href !== null) expect(hasPage(href), id).toBe(true);
      expect(href === null, id).toBe(availability.status === "planned");
    }
  });

  it("accounts for every page under /app", () => {
    const live = allDestinations()
      .filter((row) => row.destination.availability.status === "live" || (row.destination.availability.status === "planned" && row.destination.availability.notice))
      .map((row) => row.destination.path);
    for (const pattern of APP_PAGES) {
      const known = live.includes(pattern) || EXISTING_ROUTES.some((route) => route.pattern === pattern);
      expect(known, `${pattern} is a page that the navigation does not account for`).toBe(true);
    }
    for (const route of EXISTING_ROUTES) expect(APP_PAGES, route.pattern).toContain(route.pattern);
    // Every stand-in page is one of the listed existing routes, so its replacement is written down.
    for (const { id, destination } of allDestinations()) {
      if (destination.availability.status === "interim") {
        const servedBy = destination.availability.servedBy;
        expect(EXISTING_ROUTES.some((route) => served(servedBy, route.pattern)), id).toBe(true);
      }
    }
  });

  it("does not present an unbuilt agent as working, and agrees with the backend about which are built", () => {
    const mapped = AGENTS.filter((agent) => agent.backendAgent !== null);
    expect(mapped.map((agent) => agent.backendAgent).sort()).toEqual([...BACKEND_AGENTS].sort());
    for (const agent of AGENTS) {
      const built = agent.backendAgent !== null && AGENT_PROFILES[agent.backendAgent].built;
      expect(agent.workflow, agent.id).toBe(built ? "built" : "planned");
      if (agent.workflow === "planned") {
        // An agent with no workflow has no overview and no agent-specific page to open.
        expect(agent.overview.availability.status, agent.id).toBe("planned");
      }
    }
    // The backend groups the agents it knows into the same three departments, under the same names.
    expect(BACKEND_DEPARTMENTS.map((row) => [row.id, row.name])).toEqual(DEPARTMENTS.map((row) => [row.id, row.label]));
    for (const department of BACKEND_DEPARTMENTS) {
      for (const backendAgent of department.agents) expect(AGENTS.find((agent) => agent.backendAgent === backendAgent)?.department, backendAgent).toBe(department.id);
    }
    expect(BACKEND_DEPARTMENTS.flatMap((row) => row.agents).sort()).toEqual([...BACKEND_AGENTS].sort());
    expect(AGENTS.filter((agent) => agent.workflow === "built").map((agent) => agent.id)).toEqual(["dispatch"]);
    // The plan carries no numbers or states of its own: badges get their values from the record.
    expect(JSON.stringify({ AGENTS, NAV_ITEMS })).not.toMatch(/"count"|"badge"|"status":"(working|active)"/);
  });

  it("shows destinations by role without treating that as authorization, and ignores whether an agent is paused", () => {
    const finance = SHARED_ITEMS.find((item) => item.id === "finance")!;
    expect(finance.minimumRole).toBe("owner");
    expect([mayShow(finance, "owner"), mayShow(finance, "manager"), mayShow(finance, "office")]).toEqual([true, false, false]);
    // Until the owner decides who may open something, it is shown to the Owner only.
    const undecided = { ...finance, minimumRole: "undecided" as const };
    expect([mayShow(undecided, "owner"), mayShow(undecided, "manager"), mayShow(undecided, "office")]).toEqual([true, false, false]);
    // Everything else is drawn for everyone in the company; what they may do there is checked in Convex.
    for (const { id, destination } of allDestinations()) if (id !== "finance") expect(mayShow(destination, "office"), id).toBe(true);
    for (const { id, destination } of allDestinations()) expect(mayShow(destination, "owner"), id).toBe(true);
    // mayShow takes a destination and a role and nothing else, so a paused agent cannot hide its records.
    expect(mayShow.length).toBe(2);
  });
});

describe("navigation behavior", () => {
  it("starts a new workspace on Operations, and remembers per person and per company", () => {
    expect(initialSidebarState()).toEqual({ department: "operations", expanded: [] });
    expect(sidebarStorageKey("user_1", "company_a")).not.toBe(sidebarStorageKey("user_1", "company_b"));
    expect(sidebarStorageKey("user_1", "company_a")).not.toBe(sidebarStorageKey("user_2", "company_a"));
    const state = { department: "team" as const, expanded: ["dispatch" as const, "recruiter" as const] };
    expect(parseSidebarState(serializeSidebarState(state))).toEqual(state);
    // Stored state that is missing, broken or names something that no longer exists falls back safely.
    for (const raw of [null, "", "not json", "{}", '{"department":"sales","expanded":"dispatch"}']) expect(parseSidebarState(raw)).toEqual(initialSidebarState());
    expect(parseSidebarState('{"department":"growth","expanded":["sales","books","sales"]}')).toEqual({ department: "growth", expanded: ["sales"] });
  });

  it("changes only the listed agents when a department is chosen", () => {
    const before = { department: "operations" as const, expanded: ["dispatch" as const] };
    const after = selectDepartment(before, "growth");
    expect(after).toEqual({ department: "growth", expanded: ["dispatch"] });
    // It returns state and nothing else: there is no path in it to navigate to.
    expect(Object.keys(after).sort()).toEqual(["department", "expanded"]);
  });

  it("lets several agents be open at once, and the arrow only opens and closes", () => {
    let state = initialSidebarState();
    state = toggleAgent(state, "quality");
    state = toggleAgent(state, "dispatch");
    state = toggleAgent(state, "sales");
    expect(state.expanded).toEqual(["sales", "dispatch", "quality"]);
    expect(state.department).toBe("operations");
    expect(toggleAgent(state, "dispatch").expanded).toEqual(["sales", "quality"]);
  });

  it("opens the right department, agent and tab for a deep link", () => {
    const start = { department: "growth" as const, expanded: ["sales" as const] };
    expect(activeFor("/app/agents/team-coordinator/availability")).toEqual({ item: null, agent: "team-coordinator", tab: "availability", department: "team" });
    expect(syncToPath(start, "/app/agents/team-coordinator/availability")).toEqual({ department: "team", expanded: ["sales", "team-coordinator"] });
    // A record beneath a tab still highlights that tab; the overview highlights the agent alone.
    expect(activeFor("/app/agents/dispatch/live-jobs/j123?panel=1")).toMatchObject({ agent: "dispatch", tab: "live-jobs" });
    expect(activeFor("/app/agents/dispatch/")).toMatchObject({ agent: "dispatch", tab: null, department: "operations" });
    // Two tabs with the same name under different agents are told apart by the agent.
    expect(activeFor("/app/agents/recruiter/playbook")).toMatchObject({ agent: "recruiter", tab: "playbook", department: "team" });
    // A company-wide page leaves the sidebar exactly as the person left it.
    for (const path of ["/app", "/app/approvals", "/app/inbox", "/app/customers", "/app/settings", "/app/somewhere-unknown"]) expect(syncToPath(start, path)).toBe(start);
    expect(activeFor("/app")).toMatchObject({ item: "home", agent: null });
    expect(activeFor("/app/unknown")).toEqual({ item: null, agent: null, tab: null, department: null });
    expect(resolvePath("/app/agents/nobody")).toBeNull();
  });

  it("highlights the right thing on today's pages", () => {
    expect(activeFor("/app/approvals")).toMatchObject({ item: "approvals" });
    expect(activeFor("/app/customers")).toMatchObject({ item: "customers" });
    expect(activeFor("/app/cleaners")).toMatchObject({ item: "cleaners" });
    // A page that stands in for exactly one destination highlights that destination.
    expect(activeFor("/app/insights")).toMatchObject({ item: "reports" });
    expect(activeFor("/app/schedule")).toMatchObject({ agent: "dispatch", tab: "schedule", department: "operations" });
    expect(activeFor("/app/departments/operations")).toMatchObject({ agent: "dispatch", tab: "offers-coverage" });
    // Pages that only redirect, and department pages nothing points at, highlight nothing.
    for (const path of ["/app/decisions", "/app/records", "/app/team", "/app/departments/growth"]) expect(resolvePath(path), path).toBeNull();
  });

  it("builds breadcrumbs and links from the same definition", () => {
    expect(breadcrumbsFor("/app/agents/dispatch/schedule")).toEqual([
      { label: "Operations", href: null },
      // Dispatch has no overview page yet, so its crumb is not a link.
      { label: "Dispatch", href: null },
      { label: "Schedule", href: "/app/schedule" },
    ]);
    expect(breadcrumbsFor("/app/agents/marketing/campaigns")).toEqual([
      { label: "Growth", href: null },
      { label: "Marketing", href: null },
      { label: "Campaigns", href: null },
    ]);
    expect(breadcrumbsFor("/app/approvals")).toEqual([{ label: "Approvals", href: "/app/approvals" }]);
    expect(breadcrumbsFor("/app/unknown")).toEqual([]);
    expect(linkTo("approvals")).toBe("/app/approvals");
    expect(linkTo("dispatch.schedule")).toBe("/app/schedule");
    expect(linkTo("reports")).toBe("/app/insights");
    expect(linkTo("finance")).toBeNull();
    expect(linkTo("dispatch")).toBeNull();
    expect(linkTo("nothing")).toBeNull();
  });

  it("puts what needs a person ahead of a general working indicator", () => {
    const working: Badge = { kind: "working", label: "Working" };
    const review: Badge = { kind: "attention", label: "3 to review", count: 3 };
    const decision: Badge = { kind: "decision", label: "1 for you", count: 1 };
    const urgent: Badge = { kind: "urgent", label: "2 unfilled", count: 2 };
    expect(BADGE_KINDS).toEqual(["urgent", "decision", "attention", "working"]);
    expect(topBadge([working, review, decision, urgent])).toBe(urgent);
    expect(topBadge([working, decision])).toBe(decision);
    expect(topBadge([working, review])).toBe(review);
    expect(topBadge([working])).toBe(working);
    expect(topBadge([])).toBeNull();
    // A badge with no words says nothing a person can read, so it is not shown.
    expect(topBadge([{ kind: "urgent", label: " " }, working])).toBe(working);
  });
});
