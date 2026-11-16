/**
 * The integrations a company can connect, defined once. The Integrations page (Settings › Integrations) is
 * drawn from this list, and docs/integrations/00-plan.md explains each one and the order they are built in.
 *
 * An integration is a tool an agent can use for the company. Every entry says how available it is, what
 * it lets agents do (`can`), and which agents use it. Nothing here is offered as connectable until its
 * connection is built: a built one links to where it is set up; a planned one can only be requested,
 * which records the company's interest for Selestial (convex/integrations.ts) and promises no date.
 * convex/lib/integrations.ts lists the same ids for the server; a test keeps them equal.
 *
 * Only the Owner connects or disconnects an integration (the owner's decision of November 16, 2026).
 * Anyone in the company can see what is connected.
 */
import type { AgentId } from "@/lib/app/navigation";

export type IntegrationCategory = "payments" | "leads" | "google" | "microsoft" | "reviews" | "communication" | "accounting" | "hiring" | "import";

export type IntegrationStatus =
  /** Built and ready to connect, at `href` ("#google": the card itself starts that Google tool's own connection). Its live state comes from the server. */
  | { kind: "available"; href: string; setUpWhere: string }
  /** Built into the product, switched on by a setting Selestial manages (no account to connect). */
  | { kind: "built_in"; needs: "google-maps-key" }
  /** Not built yet. `phase` is the build phase in docs/integrations/00-plan.md. */
  | { kind: "planned"; phase: number };

export type Integration = {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** What it does in Selestial, in one sentence. */
  does: string;
  /** What it lets agents do, as short verb phrases. These are the tools an agent gets. */
  can: string[];
  /** The agents that use it, the one who leans on it most first. */
  agents: AgentId[];
  status: IntegrationStatus;
  /** Who pays whom, or who owns the account, when that is not obvious. */
  note?: string;
};

export const CATEGORIES: readonly { id: IntegrationCategory; label: string; lead: string }[] = [
  { id: "payments", label: "Payments", lead: "Get paid by your customers. Selestial never holds your money: it goes to the account you connect." },
  { id: "leads", label: "Lead sources", lead: "Where new customers find you. Each new lead reaches Sales the moment it arrives, so nobody waits for a reply." },
  { id: "google", label: "Google", lead: "Connect each Google tool on its own (Drive, Docs and Sheets, Calendar, Business Profile, Ads), with the Google account you choose for it, and choose exactly which files, calendars and locations it may use. Gmail is connected for the hiring inbox. Address search and travel times are built in." },
  { id: "microsoft", label: "Microsoft 365", lead: "For companies on Microsoft instead of Google: the same jobs with Outlook and OneDrive." },
  { id: "reviews", label: "Reviews", lead: "Retention asks happy customers for a review where it helps you most, and drafts replies for your approval." },
  { id: "communication", label: "Texting", lead: "Texts to customers, cleaners and applicants go through one sending policy: consent, quiet hours and limits." },
  { id: "accounting", label: "Accounting", lead: "Invoices, payments and fees land in your books without retyping." },
  { id: "hiring", label: "Hiring", lead: "Where the Recruiter finds applicants and checks them before a first visit." },
  { id: "import", label: "Moving in", lead: "Bring your customers, properties and recurring visits from the software you use today." },
];

const planned = (phase: number): IntegrationStatus => ({ kind: "planned", phase });

export const INTEGRATIONS: readonly Integration[] = [
  // Payments
  { id: "stripe", name: "Stripe", category: "payments", does: "Charge customers by card or bank transfer for visits and invoices, with saved cards for recurring service.", can: ["charge cards", "save cards", "send invoices", "issue refunds"], agents: ["sales", "retention"], status: planned(4), note: "Your own Stripe account, connected through Stripe Connect." },
  { id: "square", name: "Square", category: "payments", does: "Take cards in person or online, send invoices and use tap to pay, through your Square account.", can: ["take cards", "send invoices", "tap to pay"], agents: ["sales", "retention"], status: planned(4) },
  { id: "quickbooks-payments", name: "QuickBooks Payments", category: "payments", does: "Collect card and bank payments that land straight in QuickBooks.", can: ["take cards", "take bank payments", "post to QuickBooks"], agents: ["retention"], status: planned(4) },
  { id: "paypal", name: "PayPal and Venmo", category: "payments", does: "Let customers pay an invoice with PayPal or Venmo.", can: ["request payment", "take PayPal", "take Venmo"], agents: ["retention"], status: planned(4) },

  // Lead sources
  { id: "google-local-services-ads", name: "Google Local Services Ads", category: "leads", does: "Calls, messages and booking requests from your Google Guaranteed listing go straight to Sales, which answers fast and keeps the lead within Google's response rules.", can: ["receive leads", "reply fast", "track bookings"], agents: ["sales", "marketing"], status: { kind: "available", href: "#google", setUpWhere: "this card" } },
  { id: "google-ads", name: "Google Ads", category: "leads", does: "Leads from your Google Ads lead forms reach Sales at once, and booked jobs are reported back to Google Ads so it learns which clicks become customers.", can: ["receive form leads", "send conversions"], agents: ["sales", "marketing"], status: { kind: "available", href: "#google", setUpWhere: "this card" } },
  { id: "meta-lead-ads", name: "Meta lead ads", category: "leads", does: "Leads from your Facebook and Instagram lead forms reach Sales at once, and booked jobs are reported back to Meta so your ads find more people like your customers.", can: ["receive form leads", "send conversions"], agents: ["sales", "marketing"], status: planned(6) },

  // Google
  { id: "google-address", name: "Address search", category: "google", does: "Every address field suggests real US addresses as you type, and saves the map location so Dispatch knows where each property is.", can: ["suggest addresses", "save map points"], agents: ["dispatch", "sales"], status: { kind: "built_in", needs: "google-maps-key" }, note: "Built in: no account to connect. Selestial provides the Google Maps key." },
  { id: "google-maps-travel", name: "Travel times", category: "google", does: "Dispatch uses real drive times between visits to choose cleaners and order the day.", can: ["time drives", "order the day"], agents: ["dispatch", "team-coordinator"], status: { kind: "available", href: "#google", setUpWhere: "this card" } },
  { id: "google-drive", name: "Google Drive", category: "google", does: "Agents read your price sheets, policies and scripts from a folder you choose, and file what they make: job photos and checklists, signed agreements, quotes, applicant resumes and new documents.", can: ["read documents", "save photos", "file agreements", "create documents"], agents: ["marketing", "sales", "dispatch", "quality", "recruiter"], status: { kind: "available", href: "#google", setUpWhere: "this card" } },
  { id: "google-calendar", name: "Google Calendar", category: "google", does: "Visits and interviews appear in your calendar, and busy times there block scheduling. Both ways.", can: ["read busy times", "add visits", "add interviews"], agents: ["dispatch", "recruiter", "team-coordinator"], status: { kind: "available", href: "#google", setUpWhere: "this card" } },
  { id: "gmail", name: "Gmail", category: "google", does: "Connect your company's Gmail: Recruiter reads hiring mail from it, and applicant email goes from your own address instead of a Selestial one.", can: ["read hiring mail", "send as your address"], agents: ["recruiter", "sales", "retention", "customer-care"], status: { kind: "available", href: "/app/settings/recruiting", setUpWhere: "Settings › Recruiting rules" } },
  { id: "google-business-profile", name: "Google Business Profile", category: "google", does: "Retention asks happy customers for a Google review and drafts replies to new reviews for your approval.", can: ["ask for reviews", "read reviews", "draft replies"], agents: ["retention", "marketing"], status: { kind: "available", href: "#google", setUpWhere: "this card" } },

  // Microsoft 365
  { id: "outlook", name: "Outlook email and calendar", category: "microsoft", does: "Agents send from your company's Outlook address, and visits and interviews appear in your Outlook calendar, with busy times blocking scheduling. Both ways.", can: ["send as your address", "read busy times", "add visits"], agents: ["sales", "retention", "customer-care", "dispatch", "recruiter"], status: planned(3) },
  { id: "onedrive", name: "OneDrive", category: "microsoft", does: "The same as Google Drive, in OneDrive: agents read your documents from a folder you choose and file what they make.", can: ["read documents", "save photos", "file agreements", "create documents"], agents: ["marketing", "sales", "dispatch", "quality", "recruiter"], status: planned(3) },

  // Reviews (Google Business Profile reviews are in the Google group)
  { id: "yelp", name: "Yelp", category: "reviews", does: "See your Yelp reviews beside the customer, and draft replies for your approval. Yelp does not allow asking customers for reviews, so Retention never does.", can: ["read reviews", "draft replies"], agents: ["retention", "marketing"], status: planned(6) },
  { id: "facebook-reviews", name: "Facebook recommendations", category: "reviews", does: "Retention asks happy customers to recommend you on Facebook and drafts replies to new recommendations for your approval.", can: ["ask for recommendations", "draft replies"], agents: ["retention", "marketing"], status: planned(6) },

  // Texting
  { id: "texting-number", name: "Business texting number", category: "communication", does: "Selestial gives your company its own local number and handles the carrier registration. You pick the area code.", can: ["send texts", "receive texts", "register with carriers"], agents: ["sales", "dispatch", "retention", "customer-care", "recruiter"], status: { kind: "available", href: "/app/settings/compliance", setUpWhere: "Settings › Compliance" }, note: "Provided by Selestial through Telnyx. No account of your own needed." },

  // Accounting
  { id: "quickbooks-online", name: "QuickBooks Online", category: "accounting", does: "Customers, invoices, payments and processing fees sync to QuickBooks.", can: ["sync customers", "post invoices", "post payments", "post fees"], agents: [], status: planned(5) },
  { id: "xero", name: "Xero", category: "accounting", does: "Customers, invoices, payments and processing fees sync to Xero.", can: ["sync customers", "post invoices", "post payments", "post fees"], agents: [], status: planned(5) },

  // Hiring
  { id: "indeed", name: "Indeed", category: "hiring", does: "Post cleaner openings and bring applicants straight into the Recruiter.", can: ["post openings", "receive applicants"], agents: ["recruiter"], status: planned(5) },
  { id: "checkr", name: "Checkr", category: "hiring", does: "Run a background check, with the applicant's consent, before a cleaner's first visit.", can: ["order checks", "read results"], agents: ["recruiter"], status: planned(5) },

  // Moving in
  { id: "jobber", name: "Jobber", category: "import", does: "Import customers, properties and recurring visits from Jobber.", can: ["import customers", "import properties", "import recurring visits"], agents: [], status: planned(5) },
  { id: "housecall-pro", name: "Housecall Pro", category: "import", does: "Import customers, properties and recurring visits from Housecall Pro.", can: ["import customers", "import properties", "import recurring visits"], agents: [], status: planned(5) },
  { id: "zenmaid", name: "ZenMaid", category: "import", does: "Import customers, properties and recurring visits from ZenMaid.", can: ["import customers", "import properties", "import recurring visits"], agents: [], status: planned(5) },
  { id: "launch27", name: "Launch27", category: "import", does: "Import customers, properties and recurring bookings from Launch27.", can: ["import customers", "import properties", "import recurring bookings"], agents: [], status: planned(5) },
];

export function integrationsIn(category: IntegrationCategory): Integration[] {
  return INTEGRATIONS.filter((integration) => integration.category === category);
}

/** The integrations an agent uses. */
export function integrationsFor(agent: AgentId): Integration[] {
  return INTEGRATIONS.filter((integration) => integration.agents.includes(agent));
}
