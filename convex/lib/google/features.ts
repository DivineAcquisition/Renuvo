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
    does: "Read the files and folders you pick, and save photos, resumes, agreements, reports and new documents into the folders you pick. Selestial sees only files you pick or that it creates.",
    needsPlatform: ["NEXT_PUBLIC_GOOGLE_PICKER_API_KEY", "NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER"],
  },
  calendar: {
    label: "Google Calendar",
    scopes: [SCOPE.calendarList, SCOPE.calendarEvents, SCOPE.calendarFreeBusy],
    does: "Put visits and interviews on the calendar you choose, read busy times from the calendars you choose, and notice when an event Selestial made is moved or deleted.",
  },
  business_profile: {
    label: "Google Business Profile",
    scopes: [SCOPE.business],
    does: "Read reviews for the locations you choose, draft replies, and publish only the replies you approve.",
  },
  ads: {
    label: "Google Ads and Local Services Ads",
    scopes: [SCOPE.ads],
    does: "Read the ad accounts you choose and their results, take in leads from lead forms and Local Services Ads, and prepare campaign drafts. Nothing is turned on or spends money without your approval.",
    needsPlatform: ["GOOGLE_ADS_DEVELOPER_TOKEN"],
  },
  conversions: {
    label: "Google Ads conversion reporting",
    scopes: [SCOPE.dataManager],
    does: "Report booked jobs that came from a Google ad back to Google Ads, with the consent you record, so the ads learn which clicks become customers.",
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
