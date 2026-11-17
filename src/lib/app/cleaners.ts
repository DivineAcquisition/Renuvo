/**
 * The Cleaners workspace's state lives in the address: the search, every filter, the view, and the
 * worker open in the side panel. So opening and closing a profile never loses the list, a link can be
 * copied and shared, and the browser's Back does what a person expects. Pure functions, tested.
 */
import { APP_ROOT } from "./navigation";

export const CLEANERS_ROOT = `${APP_ROOT}/cleaners`;

export const PROFILE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "availability", label: "Availability & Jobs" },
  { id: "onboarding", label: "Onboarding & Documents" },
  { id: "skills", label: "Skills & Equipment" },
  { id: "performance", label: "Performance & Coaching" },
  { id: "pay", label: "Pay" },
  { id: "activity", label: "Activity" },
] as const;
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]["id"];

export function isSection(value: string | null | undefined): value is ProfileSectionId {
  return PROFILE_SECTIONS.some((section) => section.id === value);
}

/** A worker's own page, optionally opened at one section. */
export function cleanerPath(cleanerId: string, section?: ProfileSectionId): string {
  return `${CLEANERS_ROOT}/${cleanerId}${section && section !== "overview" ? `?section=${section}` : ""}`;
}

export type View = "cards" | "table";
export type ReadinessFilter = "ready" | "blocked" | "onboarding" | "paused" | "ended";
export type QuickFilter = "attention" | "working_today";

export type DirectoryState = {
  q: string;
  view: View;
  type: string[];
  status: string[];
  readiness: ReadinessFilter[];
  crew: string[];
  area: string[];
  skill: string[];
  subcontractor: string[];
  /** Where the company's onboarding requirements stand. */
  stage: string[];
  quick: QuickFilter | null;
  /** An availability window on the company's clock: a date and a start and end time. */
  window: { date: string; from: string; to: string } | null;
  /** The worker open in the side panel. */
  open: string | null;
};

export const EMPTY_STATE: DirectoryState = { q: "", view: "cards", type: [], status: [], readiness: [], crew: [], area: [], skill: [], subcontractor: [], stage: [], quick: null, window: null, open: null };

const LIST_KEYS = ["type", "status", "readiness", "crew", "area", "skill", "subcontractor", "stage"] as const;
const READINESS: readonly ReadinessFilter[] = ["ready", "blocked", "onboarding", "paused", "ended"];
const QUICK: readonly QuickFilter[] = ["attention", "working_today"];

const listOf = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 50);

/** Reads the state from a query string. Anything malformed is ignored, never guessed at. */
export function parseDirectory(params: URLSearchParams): DirectoryState {
  const state: DirectoryState = { ...EMPTY_STATE, q: (params.get("q") ?? "").slice(0, 100), view: params.get("view") === "table" ? "table" : "cards" };
  for (const key of LIST_KEYS) state[key] = listOf(params.get(key)) as never;
  state.readiness = state.readiness.filter((value) => READINESS.includes(value));
  const quick = params.get("quick");
  state.quick = QUICK.includes(quick as QuickFilter) ? (quick as QuickFilter) : null;
  const avail = /^(\d{4}-\d{2}-\d{2}),(\d{2}:\d{2}),(\d{2}:\d{2})$/.exec(params.get("avail") ?? "");
  state.window = avail && avail[2] < avail[3] ? { date: avail[1], from: avail[2], to: avail[3] } : null;
  const open = params.get("cleaner");
  state.open = open && /^[a-z0-9]{8,64}$/i.test(open) ? open : null;
  return state;
}

/** Writes the state back, leaving out anything at its default so links stay short. Other parameters are kept. */
export function writeDirectory(state: DirectoryState, keep: URLSearchParams = new URLSearchParams()): string {
  const params = new URLSearchParams(keep);
  for (const key of ["q", "view", ...LIST_KEYS, "quick", "avail", "cleaner"]) params.delete(key);
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.view !== "cards") params.set("view", state.view);
  for (const key of LIST_KEYS) if (state[key].length > 0) params.set(key, state[key].join(","));
  if (state.quick) params.set("quick", state.quick);
  if (state.window) params.set("avail", `${state.window.date},${state.window.from},${state.window.to}`);
  if (state.open) params.set("cleaner", state.open);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function activeFilterCount(state: DirectoryState): number {
  return LIST_KEYS.reduce((sum, key) => sum + state[key].length, 0) + (state.quick ? 1 : 0) + (state.window ? 1 : 0);
}

/** Where the list was, so a worker's own page can lead back to exactly that list. */
export const LAST_LIST_KEY = "selestial.cleaners.list";

export const STAGE_WORDS: Record<string, string> = {
  none: "No requirements apply",
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_review: "Waiting for review",
  needs_changes: "Needs changes",
  complete: "Complete",
};

export type FilterableRow = {
  cleanerId: string;
  name: string;
  preferredName: string | null;
  engagement: string;
  status: string;
  readiness: { state: string };
  serviceAreas: string[];
  skills: string[];
  crews: { id: string }[];
  subcontractor: { id: string; name: string } | null;
  phone: string | null;
  email: string | null;
  attention: number;
  workingToday: boolean;
  onboarding?: { stage: string };
};

const fold = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * The rows that match. Search reads names, contact details, areas, skills and the supplying company.
 * `available` is the answer for the chosen window, when one is chosen: a worker with no answer is left out.
 */
export function filterRows<R extends FilterableRow>(rows: R[], state: DirectoryState, available?: Record<string, { available: boolean }> | null): R[] {
  const terms = fold(state.q).split(/\s+/).filter(Boolean);
  const digits = state.q.replace(/[^\d]/g, "");
  return rows.filter((row) => {
    if (terms.length > 0) {
      const hay = fold([row.name, row.preferredName ?? "", row.email ?? "", row.subcontractor?.name ?? "", ...row.serviceAreas, ...row.skills].join(" "));
      const phoneHit = digits.length >= 4 && (row.phone ?? "").replace(/[^\d]/g, "").includes(digits);
      if (!phoneHit && !terms.every((term) => hay.includes(term))) return false;
    }
    if (state.type.length > 0 && !state.type.includes(row.engagement)) return false;
    if (state.status.length > 0 && !state.status.includes(row.status)) return false;
    if (state.readiness.length > 0 && !state.readiness.includes(row.readiness.state as ReadinessFilter)) return false;
    if (state.crew.length > 0 && !row.crews.some((crew) => state.crew.includes(crew.id))) return false;
    if (state.area.length > 0 && !row.serviceAreas.some((area) => state.area.includes(area))) return false;
    if (state.skill.length > 0 && !state.skill.every((skill) => row.skills.includes(skill))) return false;
    if (state.subcontractor.length > 0 && !(row.subcontractor && state.subcontractor.includes(row.subcontractor.id))) return false;
    if (state.stage.length > 0 && !state.stage.includes(row.onboarding?.stage ?? "none")) return false;
    if (state.quick === "attention" && row.attention === 0) return false;
    if (state.quick === "working_today" && !row.workingToday) return false;
    if (state.window && available && !available[row.cleanerId]?.available) return false;
    return true;
  });
}

/** A small CSV reader: quoted fields, doubled quotes, commas and new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === "," || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true, aliases: ["name", "full name", "cleaner", "worker", "employee name"] },
  { key: "preferredName", label: "Preferred name", required: false, aliases: ["preferred name", "nickname", "goes by"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "e mail", "email address"] },
  { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "cell", "phone number", "mobile number"] },
  { key: "workerType", label: "Worker type", required: false, aliases: ["worker type", "type", "classification", "employment type", "engagement"] },
  { key: "serviceAreas", label: "Service areas", required: false, aliases: ["service areas", "areas", "zip", "zips", "zip codes", "postal codes", "service area"] },
  { key: "skills", label: "Skills", required: false, aliases: ["skills", "skill", "specialties", "services"] },
  { key: "subcontractor", label: "Subcontractor company", required: false, aliases: ["subcontractor", "subcontractor company", "company", "agency"] },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** Which column holds which field, read from the header row. A column it cannot place is left unused. */
export function guessColumns(header: string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  const clean = header.map((cell) => cell.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "));
  for (const field of IMPORT_FIELDS) {
    const index = clean.findIndex((cell, at) => (field.aliases as readonly string[]).includes(cell) && !Object.values(out).includes(at));
    if (index >= 0) out[field.key] = index;
  }
  return out;
}
