import { ACTIVITIES, type Activity } from "../../../../convex/lib/texting/activities";

export const ACTIVITIES_BY_KEY: Record<string, Activity> = Object.fromEntries(ACTIVITIES.map((row) => [row.key, row]));

export const AUDIENCE_LABEL: Record<Activity["audience"], string> = { customer: "Customers", cleaner: "Cleaners", applicant: "Applicants" };
export const CATEGORY_LABEL: Record<Activity["category"], string> = { operational: "Work texts", recruiting: "Hiring texts", marketing: "Marketing" };
