/**
 * The integrations a company can connect, defined once. The Integrations page (Company → Integrations) is
 * drawn from this list, and docs/integrations/00-plan.md explains each one and the order they are built in.
 *
 * Every entry says how available it is. Nothing here is offered as connectable until its connection is
 * built: a planned integration is listed with what it will do, never with a working Connect button.
 *
 * Only the Owner connects or disconnects an integration (the owner's decision of November 16, 2026).
 * Anyone in the company can see what is connected.
 */
import type { AgentId } from "@/lib/app/navigation";

export type IntegrationCategory = "payments" | "google" | "communication" | "accounting" | "hiring" | "import";

export type IntegrationStatus =
  /** Built and ready to connect. */
  | { kind: "available" }
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
  /** The agents that use it, if any. */
  agents: AgentId[];
  status: IntegrationStatus;
  /** Who pays whom, or who owns the account, when that is not obvious. */
  note?: string;
};

export const CATEGORIES: readonly { id: IntegrationCategory; label: string; lead: string }[] = [
  { id: "payments", label: "Payments", lead: "Get paid by your customers. Selestial never holds your money: it goes to the account you connect." },
  { id: "google", label: "Google", lead: "One Google connection covers Drive, Calendar, Gmail and your Business Profile. Address search and travel times are built in." },
  { id: "communication", label: "Texting", lead: "Texts to customers, cleaners and applicants go through one sending policy: consent, quiet hours and limits." },
  { id: "accounting", label: "Accounting", lead: "Invoices, payments and fees land in your books without retyping." },
  { id: "hiring", label: "Hiring", lead: "Where the Recruiter finds applicants and checks them before a first visit." },
  { id: "import", label: "Moving in", lead: "Bring your customers, properties and recurring visits from the software you use today." },
];

const planned = (phase: number): IntegrationStatus => ({ kind: "planned", phase });

export const INTEGRATIONS: readonly Integration[] = [
  // Payments
  { id: "stripe", name: "Stripe", category: "payments", does: "Charge customers by card or bank transfer for visits and invoices, with saved cards for recurring service.", agents: ["sales", "retention"], status: planned(4), note: "Your own Stripe account, connected through Stripe Connect." },
  { id: "square", name: "Square", category: "payments", does: "Take cards in person or online, send invoices and use tap to pay, through your Square account.", agents: ["sales", "retention"], status: planned(4) },
  { id: "quickbooks-payments", name: "QuickBooks Payments", category: "payments", does: "Collect card and bank payments that land straight in QuickBooks.", agents: ["retention"], status: planned(4) },
  { id: "paypal", name: "PayPal and Venmo", category: "payments", does: "Let customers pay an invoice with PayPal or Venmo.", agents: ["retention"], status: planned(4) },

  // Google
  { id: "google-address", name: "Address search", category: "google", does: "Every address field suggests real US addresses as you type, and saves the map location so Dispatch knows where each property is.", agents: ["dispatch", "sales"], status: { kind: "built_in", needs: "google-maps-key" }, note: "Built in: no account to connect. Selestial provides the Google Maps key." },
  { id: "google-maps-travel", name: "Travel times", category: "google", does: "Dispatch uses real drive times between visits to choose cleaners and order the day.", agents: ["dispatch", "team-coordinator"], status: planned(3) },
  { id: "google-drive", name: "Google Drive", category: "google", does: "Agents read your price sheets, policies and scripts from a folder you choose, and file what they make: job photos and checklists, signed agreements, quotes, applicant resumes and new documents.", agents: ["marketing", "sales", "dispatch", "quality", "recruiter"], status: planned(3) },
  { id: "google-calendar", name: "Google Calendar", category: "google", does: "Visits and interviews appear in your calendar, and busy times there block scheduling. Both ways.", agents: ["dispatch", "recruiter", "team-coordinator"], status: planned(3) },
  { id: "gmail", name: "Gmail", category: "google", does: "Agents send email from your company's own address instead of a Selestial one.", agents: ["sales", "retention", "customer-care", "recruiter"], status: planned(3) },
  { id: "google-business-profile", name: "Google Business Profile", category: "google", does: "Retention asks happy customers for a Google review and drafts replies to new reviews for your approval.", agents: ["retention", "marketing"], status: planned(3) },

  // Texting
  { id: "texting-number", name: "Business texting number", category: "communication", does: "Selestial gives your company its own local number and handles the carrier registration. You pick the area code.", agents: ["sales", "dispatch", "retention", "customer-care", "recruiter"], status: planned(5), note: "Provided by Selestial through Twilio. No account of your own needed." },

  // Accounting
  { id: "quickbooks-online", name: "QuickBooks Online", category: "accounting", does: "Customers, invoices, payments and processing fees sync to QuickBooks.", agents: [], status: planned(5) },
  { id: "xero", name: "Xero", category: "accounting", does: "Customers, invoices, payments and processing fees sync to Xero.", agents: [], status: planned(5) },

  // Hiring
  { id: "indeed", name: "Indeed", category: "hiring", does: "Post cleaner openings and bring applicants straight into the Recruiter.", agents: ["recruiter"], status: planned(5) },
  { id: "checkr", name: "Checkr", category: "hiring", does: "Run a background check, with the applicant's consent, before a cleaner's first visit.", agents: ["recruiter"], status: planned(5) },

  // Moving in
  { id: "jobber", name: "Jobber", category: "import", does: "Import customers, properties and recurring visits from Jobber.", agents: [], status: planned(5) },
  { id: "housecall-pro", name: "Housecall Pro", category: "import", does: "Import customers, properties and recurring visits from Housecall Pro.", agents: [], status: planned(5) },
  { id: "zenmaid", name: "ZenMaid", category: "import", does: "Import customers, properties and recurring visits from ZenMaid.", agents: [], status: planned(5) },
  { id: "launch27", name: "Launch27", category: "import", does: "Import customers, properties and recurring bookings from Launch27.", agents: [], status: planned(5) },
];

export function integrationsIn(category: IntegrationCategory): Integration[] {
  return INTEGRATIONS.filter((integration) => integration.category === category);
}
