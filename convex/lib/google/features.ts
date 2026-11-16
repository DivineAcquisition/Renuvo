/**
 * What a company's Google connection can be used for, and the least access each use needs. Consent is
 * asked per feature, incrementally: turning on Calendar later adds Calendar's scopes to the same Google
 * grant (include_granted_scopes) without asking again for what was already given.
 *
 * Gmail is a separate connection (convex/recruiterMailbox.ts) because it is per mailbox, not per company,
 * and its read and send permissions are asked for separately there.
 *
 * Platform credentials (Maps, Routes, Route Optimization, Gemini) belong to Selestial and are never part
 * of a company's Google grant.
 */
export const SCOPE = {
  openid: "openid",
  email: "email",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  calendarList: "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
  calendarFreeBusy: "https://www.googleapis.com/auth/calendar.freebusy",
  business: "https://www.googleapis.com/auth/business.manage",
  ads: "https://www.googleapis.com/auth/adwords",
  dataManager: "https://www.googleapis.com/auth/datamanager",
} as const;

export const FEATURES = ["drive", "calendar", "business_profile", "ads", "conversions"] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_INFO: Record<Feature, { label: string; scopes: readonly string[]; does: string; needsPlatform?: string[] }> = {
  drive: {
    label: "Google Drive, Docs and Sheets",
    scopes: [SCOPE.driveFile],
    does: "Selestial reads the files you pick and saves photos, agreements, reports and documents to the folders you pick. It only sees what you pick or what it creates.",
  },
  calendar: {
    label: "Google Calendar",
    scopes: [SCOPE.calendarList, SCOPE.calendarEvents, SCOPE.calendarFreeBusy],
    does: "Visits and interviews appear on the calendar you choose, and busy times on your calendars are respected when scheduling.",
  },
  business_profile: {
    label: "Google Business Profile",
    scopes: [SCOPE.business],
    does: "See reviews for your locations and reply to them. Nothing is posted until you approve it.",
  },
  ads: {
    label: "Google Ads",
    scopes: [SCOPE.ads],
    does: "See how your ads perform, get leads from lead forms and Local Services Ads, and prepare campaigns. Nothing runs or spends money without your approval.",
  },
  conversions: {
    label: "Booked-job reporting",
    scopes: [SCOPE.dataManager],
    does: "Let Google Ads know when someone who clicked an ad books a visit, so your ads find more customers like them.",
  },
};

const IDENTITY = [SCOPE.openid, SCOPE.email];

/** The scopes to ask for when these features are wanted. Identity is always asked for, to know which Google account it is. */
export function scopesFor(features: readonly Feature[]): string[] {
  return [...new Set([...IDENTITY, ...features.flatMap((f) => FEATURE_INFO[f].scopes)])];
}

/** Which features the scopes Google actually granted allow. A partial consent enables only what was granted in full. */
export function enabledFeatures(granted: readonly string[]): Feature[] {
  const set = new Set(granted);
  return FEATURES.filter((f) => FEATURE_INFO[f].scopes.every((scope) => set.has(scope)));
}

/** What a feature still lacks, by scope. */
export function missingScopes(feature: Feature, granted: readonly string[]): string[] {
  const set = new Set(granted);
  return FEATURE_INFO[feature].scopes.filter((scope) => !set.has(scope));
}

export function isFeature(value: string): value is Feature {
  return (FEATURES as readonly string[]).includes(value);
}
