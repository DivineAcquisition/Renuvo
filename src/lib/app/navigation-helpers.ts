/**
 * Everything the sidebar, breadcrumbs and deep links need, derived from the one definition in
 * navigation.ts. These are pure functions: no React, no storage, no network. The future sidebar
 * component calls them; it does not re-implement them.
 */
import {
  AGENT_IDS,
  AGENTS,
  BADGE_KINDS,
  DEFAULT_DEPARTMENT,
  DEPARTMENT_IDS,
  DEPARTMENTS,
  NAV_ITEMS,
  type AgentId,
  type AgentNav,
  type Badge,
  type DepartmentId,
  type Destination,
  type NavItem,
  type Role,
  type WorkTab,
} from "./navigation";

// ── Lookups ─────────────────────────────────────────────────────────────────────────────────────────

export function agentsIn(department: DepartmentId): AgentNav[] {
  return AGENTS.filter((agent) => agent.department === department);
}

export function agentById(id: string): AgentNav | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

export function departmentOf(agent: AgentId): DepartmentId {
  return AGENTS.find((row) => row.id === agent)!.department;
}

export function departmentLabel(id: DepartmentId): string {
  return DEPARTMENTS.find((department) => department.id === id)!.label;
}

/** Every destination in the plan, with a stable id: "home", "dispatch", "dispatch.schedule". */
export function allDestinations(): { id: string; label: string; destination: Destination }[] {
  return [
    ...NAV_ITEMS.map((item) => ({ id: item.id as string, label: item.label, destination: item as Destination })),
    ...AGENTS.flatMap((agent) => [
      { id: agent.id as string, label: agent.label, destination: agent.overview },
      ...agent.tabs.map((tab) => ({ id: `${agent.id}.${tab.id}`, label: `${agent.label} › ${tab.label}`, destination: tab as Destination })),
    ]),
  ];
}

// ── Availability and access ─────────────────────────────────────────────────────────────────────────

/**
 * Where a link to this destination should go today. Null means it is not built and must not be linked
 * as if it worked: the sidebar shows it as "not built yet" instead.
 */
export function hrefFor(destination: Destination): string | null {
  const { availability } = destination;
  if (availability.status === "live") return destination.path;
  if (availability.status === "interim") return availability.servedBy;
  return null;
}

/**
 * The link for a destination named by its id ("approvals", "dispatch.schedule"). Every link in the app
 * to a navigation destination comes through here, so a page that moves is changed in one place.
 */
export function linkTo(id: string): string | null {
  const found = allDestinations().find((row) => row.id === id);
  return found ? hrefFor(found.destination) : null;
}

const ROLE_RANK: Record<Role, number> = { office: 0, manager: 1, owner: 2 };

/**
 * Whether to show a destination to someone with this role. Showing or hiding a link is a courtesy.
 * It is not authorization: Convex checks every read and write, whatever the sidebar shows.
 * An undecided destination is shown to the Owner only until the owner decides.
 *
 * A paused agent is deliberately not an input: its records stay reachable while it is paused.
 */
export function mayShow(destination: Destination, role: Role): boolean {
  if (destination.minimumRole === "undecided") return role === "owner";
  return ROLE_RANK[role] >= ROLE_RANK[destination.minimumRole];
}

// ── Resolving a path ────────────────────────────────────────────────────────────────────────────────

export type Resolved =
  | { kind: "item"; item: NavItem }
  | { kind: "agent"; agent: AgentNav; tab: null }
  | { kind: "agent"; agent: AgentNav; tab: WorkTab };

const clean = (pathname: string) => {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return path === "" ? "/" : path;
};
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * What a path is, according to the definition. A destination's own path is tried first, most specific
 * first, so a record page beneath a tab still highlights that tab. An existing page that serves exactly
 * one destination in the meantime resolves to that destination. A page that serves several (Records
 * serves both Customers & Properties and Cleaners) resolves to nothing, so neither is wrongly highlighted.
 */
export function resolvePath(pathname: string): Resolved | null {
  const path = clean(pathname);
  const candidates: { base: string; resolved: Resolved }[] = [];
  for (const agent of AGENTS) {
    candidates.push({ base: agent.overview.path, resolved: { kind: "agent", agent, tab: null } });
    for (const tab of agent.tabs) candidates.push({ base: tab.path, resolved: { kind: "agent", agent, tab } });
  }
  for (const item of NAV_ITEMS) candidates.push({ base: item.path, resolved: { kind: "item", item } });

  const own = candidates.filter((candidate) => (candidate.base === "/app" ? path === "/app" : under(path, candidate.base))).sort((a, b) => b.base.length - a.base.length)[0];
  if (own) return own.resolved;

  const serving = candidates.filter(({ resolved }) => {
    const destination: Destination = resolved.kind === "item" ? resolved.item : (resolved.tab ?? resolved.agent.overview);
    return destination.availability.status === "interim" && under(path, destination.availability.servedBy);
  });
  return serving.length === 1 ? serving[0].resolved : null;
}

/** The exact thing to highlight for a path: one company-wide item, or one agent and at most one of its tabs. */
export function activeFor(pathname: string): { item: NavItem["id"] | null; agent: AgentId | null; tab: string | null; department: DepartmentId | null } {
  const resolved = resolvePath(pathname);
  if (!resolved) return { item: null, agent: null, tab: null, department: null };
  if (resolved.kind === "item") return { item: resolved.item.id, agent: null, tab: null, department: null };
  return { item: null, agent: resolved.agent.id, tab: resolved.tab?.id ?? null, department: resolved.agent.department };
}

export type Crumb = { label: string; href: string | null };

/**
 * The trail for a path: "Operations › Dispatch › Schedule", or just "Approvals". A department has no
 * page of its own, so its crumb is never a link.
 */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const resolved = resolvePath(pathname);
  if (!resolved) return [];
  if (resolved.kind === "item") return [{ label: resolved.item.label, href: hrefFor(resolved.item) }];
  const trail: Crumb[] = [
    { label: departmentLabel(resolved.agent.department), href: null },
    { label: resolved.agent.label, href: hrefFor(resolved.agent.overview) },
  ];
  if (resolved.tab) trail.push({ label: resolved.tab.label, href: hrefFor(resolved.tab) });
  return trail;
}

// ── Sidebar state ───────────────────────────────────────────────────────────────────────────────────

/** What the sidebar remembers. Kept per person and per company. */
export type SidebarState = {
  /** The department tab that is selected. It only chooses which agents are listed. */
  department: DepartmentId;
  /** The agents whose tabs are open. Any number may be open at once. */
  expanded: AgentId[];
};

export function initialSidebarState(): SidebarState {
  return { department: DEFAULT_DEPARTMENT, expanded: [] };
}

/** Where the state is kept in the browser: one entry for each person in each company. */
export function sidebarStorageKey(userId: string, companyId: string): string {
  return `selestial.sidebar:${userId}:${companyId}`;
}

/** Reads stored state. Anything missing, malformed or naming something that no longer exists falls back safely. */
export function parseSidebarState(raw: string | null | undefined): SidebarState {
  const fallback = initialSidebarState();
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as { department?: unknown; expanded?: unknown };
    const department = (DEPARTMENT_IDS as readonly unknown[]).includes(value.department) ? (value.department as DepartmentId) : fallback.department;
    const expanded = Array.isArray(value.expanded) ? AGENT_IDS.filter((id) => (value.expanded as unknown[]).includes(id)) : [];
    return { department, expanded };
  } catch {
    return fallback;
  }
}

export function serializeSidebarState(state: SidebarState): string {
  return JSON.stringify(state);
}

/**
 * Choosing a department tab. It changes which agents are listed and nothing else: the page the person
 * is on stays where it is, and the caller must not navigate.
 */
export function selectDepartment(state: SidebarState, department: DepartmentId): SidebarState {
  return { ...state, department };
}

/**
 * The arrow beside an agent's name. It opens or closes that agent's tabs and never navigates. Opening
 * one agent leaves the others as they are.
 */
export function toggleAgent(state: SidebarState, agent: AgentId): SidebarState {
  const open = state.expanded.includes(agent);
  return { ...state, expanded: open ? state.expanded.filter((id) => id !== agent) : AGENT_IDS.filter((id) => id === agent || state.expanded.includes(id)) };
}

/**
 * Arriving at a page, by a click or a deep link. If the page belongs to an agent, that agent's
 * department is selected and the agent is opened, so the active tab is on screen. Any other page leaves
 * the sidebar as the person left it.
 */
export function syncToPath(state: SidebarState, pathname: string): SidebarState {
  const { agent, department } = activeFor(pathname);
  if (!agent || !department) return state;
  if (state.department === department && state.expanded.includes(agent)) return state;
  return { department, expanded: AGENT_IDS.filter((id) => id === agent || state.expanded.includes(id)) };
}

// ── Badges ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The one badge to show when several apply. Something urgent, then a decision that is needed, then
 * something to look at, and only then "working". A general working indicator never hides a problem.
 */
export function topBadge(badges: readonly Badge[]): Badge | null {
  const shown = badges.filter((badge) => badge.label.trim() !== "");
  if (shown.length === 0) return null;
  return [...shown].sort((a, b) => BADGE_KINDS.indexOf(a.kind) - BADGE_KINDS.indexOf(b.kind))[0];
}
