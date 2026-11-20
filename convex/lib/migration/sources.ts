/**
 * The systems a cleaning company moves from, and what Selestial supports for each today. Every claim here
 * is either something Selestial itself does (reading a CSV, recognizing columns) or is taken from the
 * provider's own help pages, with the page named in `verifiedFrom`. Instructions that could not be checked
 * against an official page say so on screen instead of guessing menu paths.
 *
 * A CSV from a provider is not an integration with that provider. Only Jobber and Housecall Pro have a
 * read-only connection in Selestial (convex/connectors.ts), and it is offered only when it is configured.
 */

export const SOURCES = ["jobber", "housecall_pro", "bookingkoala", "spreadsheet", "other", "assisted"] as const;
export type Source = (typeof SOURCES)[number];

export type SourceCard = {
  id: Source;
  name: string;
  summary: string;
  /** What works today, in plain words. */
  supported: string[];
  /** What does not come across, and why. */
  notSupported: string[];
  /** How to get the files out of the old system. Empty when there is nothing to export. */
  exportSteps: { title: string; steps: string[] }[];
  /** The official page the steps were checked against, or null when they could not be checked. */
  verifiedFrom: { url: string; checkedOn: string } | null;
  /** A read-only connection exists in Selestial for this system. Offered only when configured. */
  connector: "jobber" | "housecall_pro" | null;
};

const NEVER_BY_CSV = "Saved cards, payment authorizations, subscriptions and bank details can't move through a spreadsheet. Customers add a payment method again in Selestial.";

export const SOURCE_CARDS: Record<Source, SourceCard> = {
  jobber: {
    id: "jobber",
    name: "Jobber",
    summary: "Upload your Jobber client export as a CSV. Selestial recognizes Jobber's column names and suggests how to map them.",
    supported: ["Clients and their service addresses from a CSV export", "Upcoming visits and recurring jobs from a CSV, mapped column by column", "A read-only Jobber connection for clients and upcoming visits, where it's switched on for your workspace"],
    notSupported: ["Outstanding balances come over for reference only, with their old invoice numbers; payments and invoices themselves stay in your old system", NEVER_BY_CSV],
    exportSteps: [
      {
        title: "Export your clients",
        steps: ["In Jobber, open Clients.", "Use Jobber's export option to download your client list as a CSV.", "Upload that file here. If you also export visits or recurring jobs, add them too."],
      },
    ],
    // Jobber's help center refused automated reads when this was written, so the menu path isn't confirmed.
    verifiedFrom: null,
    connector: "jobber",
  },
  housecall_pro: {
    id: "housecall_pro",
    name: "Housecall Pro",
    summary: "Housecall Pro emails you a CSV of your customers and a CSV of your jobs. Upload both and Selestial links them.",
    supported: ["Customers from Housecall Pro's customer export", "Jobs from Housecall Pro's jobs export, as upcoming bookings", "A read-only Housecall Pro connection with your API key, where it's switched on"],
    notSupported: ["Sub-customers (child accounts) arrive as separate customers to review", "Outstanding balances come over for reference only, with their old invoice numbers; payments and invoices themselves stay in your old system", NEVER_BY_CSV],
    exportSteps: [
      { title: "Export customers", steps: ["In Housecall Pro, select Customers in the left navigation.", "Click Actions, then Export.", "Confirm your email and click Send file. Housecall Pro emails you a CSV from notifications@housecallpro.com.", "Only Admins in Housecall Pro can export."] },
      { title: "Export jobs", steps: ["Select Jobs in the left navigation.", "Click Actions, then Export.", "Verify your email and click Send File. The CSV arrives by email."] },
    ],
    verifiedFrom: { url: "https://help.housecallpro.com/en/articles/6797101-how-to-import-export-jobs-and-customers", checkedOn: "2026-11-20" },
    connector: "housecall_pro",
  },
  bookingkoala: {
    id: "bookingkoala",
    name: "BookingKoala",
    summary: "Upload a CSV of your BookingKoala customers or bookings. Selestial recognizes common BookingKoala columns like Frequency and Apt.",
    supported: ["Customers and addresses from a CSV", "Bookings and recurring frequency from a CSV, mapped column by column"],
    notSupported: ["There's no direct BookingKoala connection", "Outstanding balances come over for reference only; payments stay in your old system", NEVER_BY_CSV],
    exportSteps: [{ title: "Export from BookingKoala", steps: ["Export your customers, and your bookings if you can, as CSV from your BookingKoala admin.", "Upload the files here. Selestial shows what each one contains before anything is imported."] }],
    // BookingKoala's support site couldn't be reached when this was written.
    verifiedFrom: null,
    connector: null,
  },
  spreadsheet: {
    id: "spreadsheet",
    name: "Spreadsheet",
    summary: "Your own list in Excel or Google Sheets. Save it as CSV, or start from a Selestial template.",
    supported: ["Customers, properties, your team, recurring services, upcoming bookings, past visits and opening balances", "Templates with the columns Selestial reads"],
    notSupported: ["Excel files (.xlsx) need saving as CSV first: File › Save As › CSV in Excel, or File › Download › CSV in Google Sheets", NEVER_BY_CSV],
    exportSteps: [{ title: "Save as CSV", steps: ["Excel: File › Save As, and choose CSV UTF-8.", "Google Sheets: File › Download › Comma-separated values.", "Numbers: File › Export To › CSV."] }],
    verifiedFrom: null,
    connector: null,
  },
  other: {
    id: "other",
    name: "Another system",
    summary: "Most scheduling tools can export customers or jobs as CSV. Upload what you have and Selestial maps it with you.",
    supported: ["Any CSV with a header row", "Column suggestions you confirm"],
    notSupported: ["No direct connection", NEVER_BY_CSV],
    exportSteps: [{ title: "Export what you can", steps: ["Look for Export, Download or Reports in your current system.", "Choose CSV. Customers first, then upcoming jobs and recurring schedules if available."] }],
    verifiedFrom: null,
    connector: null,
  },
  assisted: {
    id: "assisted",
    name: "Help from Selestial",
    summary: "Send us what you have. Our team prepares the import with you, and you review every decision before anything goes live.",
    supported: ["Our team reviews your files and proposes mappings", "You approve the final import", "Selestial's AI review is included at no charge for assisted migrations"],
    notSupported: ["Our team can't approve messages to customers or spending for you", NEVER_BY_CSV],
    exportSteps: [],
    verifiedFrom: null,
    connector: null,
  },
};

/** Templates: the exact column names Selestial reads, with one example row each. */
export const TEMPLATES: Record<"customers" | "properties" | "cleaners" | "recurring" | "bookings" | "history" | "balances", { file: string; header: string[]; example: string[] }> = {
  customers: {
    file: "selestial-customers.csv",
    header: ["Customer ID", "First Name", "Last Name", "Company Name", "Customer Type", "Email", "Phone", "Street", "Apt", "City", "State", "Zip", "Notes", "Do Not Contact", "SMS Opt Out", "Email Opt Out", "Marketing Opt Out", "SMS Consent"],
    example: ["C-1001", "Dana", "Whitfield", "", "Residential", "dana@example.com", "512-555-0101", "12 Elm St", "", "Austin", "TX", "78701", "Has a friendly dog", "No", "", "", "", ""],
  },
  properties: {
    file: "selestial-properties.csv",
    header: ["Property ID", "Customer ID", "Property Name", "Street", "Apt", "City", "State", "Zip", "Property Type", "Bedrooms", "Bathrooms", "Square Feet", "Access Instructions", "Property Notes", "Site Contact", "Site Contact Phone"],
    example: ["P-2001", "C-1002", "Harbor Dental – Downtown", "400 Congress Ave", "Suite 200", "Austin", "TX", "78701", "Office", "", "2", "2400", "Lockbox 4471", "Clean after 6pm", "Maria Lopez", "512-555-0144"],
  },
  recurring: {
    file: "selestial-recurring.csv",
    header: ["Recurring ID", "Customer ID", "Property ID", "Service", "Frequency", "Next Visit", "End Date", "Start Time", "Duration", "Price", "Status", "Cleaner", "Notes"],
    example: ["R-3001", "C-1001", "", "Standard clean", "Every 2 weeks", "2027-01-08", "", "9:00 AM", "2 hours", "$140.00", "Active", "", ""],
  },
  bookings: {
    file: "selestial-bookings.csv",
    header: ["Booking ID", "Customer ID", "Property ID", "Service", "Date", "Start Time", "End Time", "Price", "Status", "Cleaner", "Recurring ID", "Notes"],
    example: ["B-4001", "C-1001", "", "Standard clean", "2027-01-08", "9:00 AM", "11:00 AM", "$140.00", "Scheduled", "", "R-3001", ""],
  },
  cleaners: {
    file: "selestial-team.csv",
    header: ["Employee ID", "First Name", "Last Name", "Email", "Phone", "Worker Type", "Skills", "Service Areas", "Availability", "Status"],
    example: ["E-1", "Maria", "Lopez", "maria@example.com", "512-555-0177", "Employee", "deep clean; move out", "78701; 78703", "Mon-Fri 8am-4pm", "Active"],
  },
  history: {
    file: "selestial-service-history.csv",
    header: ["Visit ID", "Customer ID", "Property ID", "Service", "Completed Date", "Price", "Cleaner", "Status", "Notes"],
    example: ["V-5001", "C-1001", "", "Standard clean", "2026-10-02", "$140.00", "Maria Lopez", "Completed", ""],
  },
  balances: {
    file: "selestial-opening-balances.csv",
    header: ["Invoice #", "Customer ID", "Balance Due", "Invoice Date", "Due Date", "Notes"],
    example: ["INV-1042", "C-1001", "$140.00", "2026-10-02", "2026-10-16", ""],
  },
};

/** A template as CSV text. */
export function templateCsv(kind: keyof typeof TEMPLATES): string {
  const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const { header, example } = TEMPLATES[kind];
  return `${header.map(quote).join(",")}\n${example.map(quote).join(",")}\n`;
}
