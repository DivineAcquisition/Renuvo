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
  { id: "company", label: "Company" },
  { id: "agents", label: "Your agents" },
  { id: "apps", label: "Apps & billing" },
  { id: "account", label: "Account & privacy" },
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];

export type SettingsSection = {
  id: string;
  label: string;
  group: SettingsGroupId;
  path: string;
  /** What the page is for, in one sentence an owner would recognise. */
  purpose: string;
  /** The least role that may open the page. Everything is checked again in Convex. */
  minimumRole: SettingsRole;
  /** Who may change what is on the page, in a phrase. Shown only to people who cannot change it. */
  access: string;
  /** Other words someone might search for it by. */
  keywords: readonly string[];
  /**
   * A page reached from another page rather than from the menu. It is highlighted as that page in the
   * menu, and searching finds the page that links to it.
   */
  parent?: string;
};

const section = (id: string, label: string, group: SettingsGroupId, purpose: string, access: string, keywords: string[], minimumRole: SettingsRole = "office", parent?: string): SettingsSection => ({
  id,
  label,
  group,
  path: `${SETTINGS_ROOT}/${id}`,
  purpose,
  minimumRole,
  access,
  keywords,
  ...(parent ? { parent } : {}),
});

const OWNER_CHANGES = "Only the Owner can change these settings. You can view them.";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  section("business", "Business details", "company", "Your company name, time zone, the ZIP codes you serve and the hours customers can book.", OWNER_CHANGES, ["company", "name", "timezone", "time zone", "clock", "areas", "service area", "zip", "postal", "hours", "open", "opening", "schedule", "booking hours"]),
  section("services", "Services & pricing", "company", "The cleaning services you offer, with a starting price and how long each one takes.", OWNER_CHANGES, ["catalog", "service", "services", "price", "pricing", "duration", "crew", "skills", "deep clean", "move out", "archive"]),
  section("people", "People & access", "company", "Who works in Selestial with you, what each person can do, and invitations.", "Only the Owner can invite people, change roles or remove access.", ["members", "team", "staff", "roles", "owner", "manager", "office", "invite", "invitation", "remove", "access"]),
  section("agents", "Agent controls", "agents", "What each agent may do on its own, what needs your approval, and pausing an agent.", OWNER_CHANGES, ["permissions", "approvals", "approve", "pause", "resume", "authority", "limits", "spending", "automatic", "ask me first", "ai", "ai features", "images", "video", "photo review", "document search", "chat models"]),
  section("dispatch", "Dispatch rules", "agents", "How jobs are offered to cleaners, how replacements are found, and what a finished job needs.", OWNER_CHANGES, ["offers", "offering jobs", "replacement", "backup", "coverage", "buffer", "travel", "reminder", "arrival", "late", "no-show", "photos", "completion", "cleaner links"]),
  section("recruiting", "Recruiting rules", "agents", "How applicants are invited and followed up with, interviews, and what new hires need before their first job.", OWNER_CHANGES, ["applicants", "hiring", "recruiting", "follow-ups", "reminders", "interview", "new hire", "onboarding", "requirements", "gmail", "hiring inbox", "sender", "reply"]),
  section("integrations", "Connected apps", "apps", "The apps Selestial works with for you, like Google, Gmail and your texting number, whether each one is connected, and what to do next.", "Only the Owner can connect apps, choose what Selestial may use, or request a new one.", ["apps", "integrations", "connect", "connections", "google", "drive", "docs", "sheets", "calendar", "gmail", "business profile", "reviews", "google ads", "local services", "leads", "conversions", "texting", "sms", "text messages", "number", "stripe", "quickbooks", "payments", "import", "jobber"]),
  section("billing", "Plan & Usage", "apps", "Your plan, Selestial Credits, payment details and invoices.", "Only the Owner can see billing.", ["plan", "subscription", "invoice", "invoices", "payment", "card", "operate", "expand", "price", "credits", "usage", "top-up", "billing"], "owner"),
  section("security", "Account security", "account", "Your own sign-in: password, two-step verification and signed-in devices.", "These settings are for your own account.", ["password", "two-factor", "2fa", "mfa", "two-step", "sessions", "devices", "sign in", "login"]),
  section("compliance", "Privacy & messaging", "account", "Your business identity for texting, customer consent, quiet hours and data requests.", OWNER_CHANGES, ["privacy", "messaging", "texting number", "identity", "ein", "consent", "quiet hours", "opt out", "do not contact", "tcpa", "data", "export", "delete", "registration"]),
  section("agreements", "Selestial terms", "account", "The Selestial terms your company has accepted, who accepted them and when.", "Only the Owner can accept updated terms.", ["terms", "terms of service", "accept", "selestial", "platform", "versions", "legal"]),
  section("activity", "Activity", "account", "A history of changes in your company and who made them.", "Only the Owner can see activity.", ["audit", "history", "log", "activity log", "events", "who changed", "changes"], "owner"),
  // Reached from Agent controls, not from the menu.
  section("ai", "AI features", "agents", "Which AI features your team can use.", "Only the Owner can switch AI features.", ["ai", "features"], "office", "agents"),
];

/** The sections listed in the Settings menu. Pages with a parent are reached from that page. */
export const menuSections = (list: readonly SettingsSection[]) => list.filter((row) => !row.parent);

const RANK: Record<SettingsRole, number> = { office: 0, manager: 1, owner: 2 };

export const mayOpen = (section: SettingsSection, role: SettingsRole) => RANK[role] >= RANK[section.minimumRole];

export const sectionsFor = (role: SettingsRole) => SETTINGS_SECTIONS.filter((row) => mayOpen(row, role));

export const sectionById = (id: string) => SETTINGS_SECTIONS.find((row) => row.id === id);

/** The section a path belongs to, including anything beneath it. */
export function sectionForPath(pathname: string): SettingsSection | undefined {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return SETTINGS_SECTIONS.find((row) => clean === row.path || clean.startsWith(`${row.path}/`));
}

/** The menu entry a path belongs to: a page with a parent is shown as its parent. */
export function menuSectionForPath(pathname: string): SettingsSection | undefined {
  const own = sectionForPath(pathname);
  return own?.parent ? sectionById(own.parent) : own;
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
};

export function legacyTarget(hash: string): string | null {
  return LEGACY_HASHES[hash.replace(/^#/, "").toLowerCase()] ?? null;
}
