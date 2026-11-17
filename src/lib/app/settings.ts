/**
 * Settings, defined once.
 *
 * Every section of Settings is listed here: its page, who may open it, what it is for, and the words
 * people search for it by. The settings navigation, the overview, the search and the navigation
 * catalog (src/lib/app/navigation.ts) are all derived from this list. Nothing else keeps its own copy.
 *
 * Where a section's facts live is part of the definition, so that two screens never both claim to be
 * the source of one.
 */

export const SETTINGS_ROOT = "/app/settings";

export type SettingsRole = "owner" | "manager" | "office";

export const SETTINGS_GROUPS = [
  { id: "business", label: "Your business" },
  { id: "agents", label: "Agents" },
  { id: "platform", label: "Account" },
  { id: "trust", label: "Trust & records" },
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];

export type SettingsSection = {
  id: string;
  label: string;
  group: SettingsGroupId;
  path: string;
  /** What the page is for, in a sentence. */
  purpose: string;
  /** The least role that may open the page. Everything is checked again in Convex. */
  minimumRole: SettingsRole;
  /** What a person who cannot edit sees, in a phrase. */
  access: string;
  /** Other words someone might search for it by. */
  keywords: readonly string[];
};

const section = (id: string, label: string, group: SettingsGroupId, purpose: string, access: string, keywords: string[], minimumRole: SettingsRole = "office"): SettingsSection => ({
  id,
  label,
  group,
  path: `${SETTINGS_ROOT}/${id}`,
  purpose,
  minimumRole,
  access,
  keywords,
});

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  section("business", "Business & hours", "business", "Company name and time zone, the postal codes you work in, and the hours appointments may be booked.", "Everyone reads. The Owner changes.", ["company", "name", "timezone", "time zone", "clock", "areas", "zip", "postal", "hours", "open", "schedule"]),
  section("people", "People & access", "business", "Who is in the company, their roles, and invitations.", "Everyone reads. The Owner invites, changes roles and removes access.", ["members", "team", "roles", "owner", "manager", "office", "invite", "invitation", "remove"]),
  section("agents", "Agent permissions", "agents", "What each agent may do without asking, and a way to pause it.", "Everyone reads. The Owner changes.", ["permissions", "authority", "pause", "approve", "execute", "propose", "limits"]),
  section("dispatch", "Dispatch rules", "agents", "How long cleaners have to answer, buffers, coverage, the day of service and the evidence required.", "Everyone reads. The Owner changes.", ["offers", "buffer", "travel", "coverage", "no-show", "photos", "evidence", "reminder", "broadcast", "backup"]),
  section("recruiting", "Recruiting rules", "agents", "How Recruiter invites, reminds and retains applicants, and what a new worker needs before they are ready.", "Everyone reads. The Owner changes.", ["applicants", "hiring", "follow-ups", "reminders", "retention", "onboarding", "requirements", "sending", "reply", "interview"]),
  section("integrations", "Integrations", "platform", "The services Selestial works with for your company: your Google account (Drive, Calendar, Business Profile, Ads), Gmail, the texting number, and what is coming next. Connect, choose exactly what Selestial may use, or request an integration.", "Everyone reads. The Owner connects, chooses and requests.", ["integrations", "connect", "google", "drive", "docs", "sheets", "calendar", "business profile", "reviews", "ads", "local services", "leads", "conversions", "gmail", "oauth", "texting", "sms", "number", "stripe", "quickbooks", "payments", "import", "jobber", "connections", "provider"]),
  section("ai", "AI & usage", "platform", "What AI does for the company, which features are on, and how much of this month's allowances has been used.", "Everyone reads. The Owner switches features.", ["ai", "models", "usage", "allowance", "images", "video", "generation", "chat", "cost", "tokens", "creative"]),
  section("billing", "Plan & Usage", "platform", "Your plan, Selestial Credits, spending controls, invoices and the billing portal.", "The Owner only.", ["plan", "subscription", "invoice", "payment", "operate", "expand", "price", "credits", "usage", "top-up", "billing"], "owner"),
  section("security", "Account security", "platform", "Your sign-in: password, devices and sessions.", "Your own account.", ["password", "two-factor", "2fa", "mfa", "sessions", "sign in", "login"]),
  section("compliance", "Trust & compliance", "trust", "Business identity, messaging registration, consent, quiet hours, data rights and readiness.", "Everyone reads. The Owner changes.", ["legal", "identity", "ein", "consent", "quiet hours", "tcpa", "privacy", "export", "delete", "data", "readiness", "10dlc"]),
  section("agreements", "Selestial Terms & Agreements", "trust", "Which version of Selestial's own Terms the company accepted, who, and when. Your customer and workforce agreements are under Agreements in the main menu.", "Everyone reads. The Owner accepts.", ["terms", "accept", "selestial", "platform", "versions"]),
  section("activity", "Activity log", "trust", "A record of what changed in the company and who changed it.", "The Owner only.", ["audit", "history", "log", "events", "who changed"], "owner"),
];

const RANK: Record<SettingsRole, number> = { office: 0, manager: 1, owner: 2 };

export const mayOpen = (section: SettingsSection, role: SettingsRole) => RANK[role] >= RANK[section.minimumRole];

export const sectionsFor = (role: SettingsRole) => SETTINGS_SECTIONS.filter((row) => mayOpen(row, role));

export const sectionById = (id: string) => SETTINGS_SECTIONS.find((row) => row.id === id);

/** The section a path belongs to, including anything beneath it. */
export function sectionForPath(pathname: string): SettingsSection | undefined {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return SETTINGS_SECTIONS.find((row) => clean === row.path || clean.startsWith(`${row.path}/`));
}

/** Sections whose label, purpose or keywords match every word typed. An empty query matches all. */
export function searchSections(query: string, list: readonly SettingsSection[] = SETTINGS_SECTIONS): SettingsSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((row) => {
    const haystack = `${row.label} ${row.purpose} ${row.keywords.join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Old links that pointed at a part of one long Settings page, and the page that part lives on now.
 * A hash never reaches the server, so the overview reads it in the browser.
 */
export const LEGACY_HASHES: Readonly<Record<string, string>> = {
  security: `${SETTINGS_ROOT}/security`,
  agents: `${SETTINGS_ROOT}/agents`,
  dispatch: `${SETTINGS_ROOT}/dispatch`,
  people: `${SETTINGS_ROOT}/people`,
  company: `${SETTINGS_ROOT}/business`,
  compliance: `${SETTINGS_ROOT}/compliance`,
  services: "/app/services",
};

export function legacyTarget(hash: string): string | null {
  return LEGACY_HASHES[hash.replace(/^#/, "").toLowerCase()] ?? null;
}
