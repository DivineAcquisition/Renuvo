/**
 * What a cleaning company texts, classified by content and audience, never by which agent sends it.
 *
 * Each activity is something a person would recognise ("job offers", "estimate follow-ups"). It records
 * who receives it, whether it is operational, recruiting or marketing (the same categories the sending
 * policy and consent records use), and a sample written the way Selestial actually sends it. The agent
 * groups only arrange the cards on the screen. A registration covers activities, and a send is allowed
 * only when the activity it belongs to is covered (convex/lib/texting/coverage.ts).
 */
import type { Category, RecipientKind } from "../compliance/schema";

export const ACTIVITY_GROUPS = ["sales", "recruiter", "dispatch", "retention"] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const ACTIVITY_KEYS = [
  "inquiry_replies",
  "estimate_follow_ups",
  "booking_conversations",
  "application_follow_ups",
  "interview_scheduling",
  "applicant_updates",
  "job_offers",
  "job_confirmations",
  "arrival_reminders",
  "coverage_requests",
  "service_follow_ups",
  "recurring_reminders",
  "promotions",
] as const;
export type ActivityKey = (typeof ACTIVITY_KEYS)[number];

/**
 * The carrier use case a message most plainly is. CUSTOMER_CARE: conversations about a person's own
 * request or account. ACCOUNT_NOTIFICATION: notices about something already arranged. MARKETING:
 * anything promotional. These are The Campaign Registry's standard use cases.
 */
export type UseCase = "CUSTOMER_CARE" | "ACCOUNT_NOTIFICATION" | "MARKETING";

export type Activity = {
  key: ActivityKey;
  group: ActivityGroup;
  label: string;
  detail: string;
  audience: RecipientKind;
  category: Category;
  useCase: UseCase;
  /** One message as Selestial would send it, under the company's name. */
  sample: (company: string) => string;
};

const link = "https://link.selestial.io/c/abc123";

export const ACTIVITIES: readonly Activity[] = [
  {
    key: "inquiry_replies",
    group: "sales",
    label: "Replies to inquiries",
    detail: "Answering people who asked about a cleaning, by form, text or call.",
    audience: "customer",
    category: "operational",
    useCase: "CUSTOMER_CARE",
    sample: (c) => `${c}: thanks for asking about a deep clean for your 3-bedroom home. We can come Thu at 2 PM or Fri at 10 AM. Which works better? Reply STOP to opt out.`,
  },
  {
    key: "estimate_follow_ups",
    group: "sales",
    label: "Estimate follow-ups",
    detail: "A check-in about an estimate the person asked for.",
    audience: "customer",
    category: "operational",
    useCase: "CUSTOMER_CARE",
    sample: (c) => `${c}: following up on the estimate you asked for ($180 for a standard clean). Any questions, or would you like to pick a time? ${link} Reply STOP to opt out.`,
  },
  {
    key: "booking_conversations",
    group: "sales",
    label: "Booking conversations",
    detail: "Confirming details, times and changes for a cleaning the person is booking.",
    audience: "customer",
    category: "operational",
    useCase: "CUSTOMER_CARE",
    sample: (c) => `${c}: you're booked for Tue, Mar 2 at 9 AM. Need to change anything? Reply here or use ${link} Reply STOP to opt out.`,
  },
  {
    key: "application_follow_ups",
    group: "recruiter",
    label: "Application follow-ups",
    detail: "Questions about an application the person sent to work with you.",
    audience: "applicant",
    category: "recruiting",
    useCase: "CUSTOMER_CARE",
    sample: (c) => `${c}: thanks for applying to clean with us. Are you available weekday mornings? Reply here. Reply STOP to opt out.`,
  },
  {
    key: "interview_scheduling",
    group: "recruiter",
    label: "Interview scheduling",
    detail: "Offering and confirming interview times.",
    audience: "applicant",
    category: "recruiting",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c}: your interview is Wed, Mar 3 at 11 AM. Details and directions: ${link} Reply STOP to opt out.`,
  },
  {
    key: "applicant_updates",
    group: "recruiter",
    label: "Applicant updates",
    detail: "Where an application stands, and next steps after an interview.",
    audience: "applicant",
    category: "recruiting",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c}: an update on your application is ready. Read it here: ${link} Reply STOP to opt out.`,
  },
  {
    key: "job_offers",
    group: "dispatch",
    label: "Job offers",
    detail: "Offering a cleaning job to a cleaner on your team.",
    audience: "cleaner",
    category: "operational",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c}: job offer. Standard clean, Tue, Mar 2, arrive 10:00 AM, about 3 hours, Austin 78701. Est. pay $90.00. Answer here: ${link} Reply STOP to opt out.`,
  },
  {
    key: "job_confirmations",
    group: "dispatch",
    label: "Job confirmations",
    detail: "Confirming a job a cleaner accepted, with the details they need.",
    audience: "cleaner",
    category: "operational",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c}: you're confirmed for Tue, Mar 2, arrive 10:00 AM. Address, instructions and check-in: ${link}`,
  },
  {
    key: "arrival_reminders",
    group: "dispatch",
    label: "Arrival reminders",
    detail: "A reminder before a job, and a check-in request if a cleaner has not arrived.",
    audience: "cleaner",
    category: "operational",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c} reminder: your job is Tue, Mar 2 at 10:00 AM. Check in when you arrive, or tell us if you're running late: ${link}`,
  },
  {
    key: "coverage_requests",
    group: "dispatch",
    label: "Coverage requests",
    detail: "Asking cleaners who can take a job that needs someone.",
    audience: "cleaner",
    category: "operational",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c}: a job needs coverage on Sat, Mar 6, 8:00 AM, about 4 hours, Round Rock 78664. Est. pay $120.00. Can you take it? ${link}`,
  },
  {
    key: "service_follow_ups",
    group: "retention",
    label: "Service follow-ups",
    detail: "Asking how a cleaning went, and following up on a concern.",
    audience: "customer",
    category: "operational",
    useCase: "CUSTOMER_CARE",
    sample: (c) => `${c}: how did today's cleaning go? Reply with anything we should know. Reply STOP to opt out.`,
  },
  {
    key: "recurring_reminders",
    group: "retention",
    label: "Recurring visit reminders",
    detail: "Reminders about a customer's scheduled recurring cleanings.",
    audience: "customer",
    category: "operational",
    useCase: "ACCOUNT_NOTIFICATION",
    sample: (c) => `${c} reminder: your next cleaning is Fri, Mar 5 at 9 AM. Need to change it? ${link} Reply STOP to opt out.`,
  },
  {
    key: "promotions",
    group: "retention",
    label: "Promotions",
    detail: "Offers and seasonal deals, sent only to people who separately agreed to marketing texts.",
    audience: "customer",
    category: "marketing",
    useCase: "MARKETING",
    sample: (c) => `${c}: spring deep cleans are 15% off through Apr 30. Book: ${link} Reply STOP to opt out.`,
  },
];

export const GROUP_WORDS: Record<ActivityGroup, { title: string; who: string }> = {
  sales: { title: "Sales", who: "People asking about a cleaning" },
  recruiter: { title: "Hiring", who: "People applying to work with you" },
  dispatch: { title: "Your team", who: "Cleaners who work with you" },
  retention: { title: "Your customers", who: "Customers after a cleaning" },
};

/** The chosen activities, in catalog order. */
export function chosen(keys: readonly string[]): Activity[] {
  return ACTIVITIES.filter((activity) => keys.includes(activity.key));
}

export function activityOf(key: string): Activity | undefined {
  return ACTIVITIES.find((row) => row.key === key);
}

export const isActivityKey = (key: string): key is ActivityKey => (ACTIVITY_KEYS as readonly string[]).includes(key);
