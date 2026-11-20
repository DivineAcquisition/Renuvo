/**
 * Migration tutorials: the one list of every tutorial Selestial can offer an owner moving their records in,
 * and where each one is offered. Pure data, shared by the server (publication, analytics) and the screens.
 *
 * What lives here is what a tutorial says and where its sources are. What staff change without a release
 * lives in Convex (tutorialSettings): the publication state and the media version. A screen asks for a
 * tutorial by placement, never by file, so a new video version reaches every screen at once.
 *
 * Every step below is taken from the platform's own help article, read on the date in `docsCheckedOn`.
 * `interfaceVerifiedOn` is set only once the steps were followed in a real (demo) account. A tutorial is not
 * published until both are true and its media has been reviewed; until then an owner is offered the
 * platform's own article and a way to ask for help, never a guess.
 */

export const PLATFORMS = ["jobber", "housecall_pro", "bookingkoala", "spreadsheet"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_WORDS: Record<Platform, string> = {
  jobber: "Jobber",
  housecall_pro: "Housecall Pro",
  bookingkoala: "BookingKoala",
  spreadsheet: "a spreadsheet",
};

/** What an owner is trying to bring in, or check. One tutorial does one task. */
export const TASKS = ["customers", "properties", "appointments", "recurring", "team", "history", "spreadsheet_prep", "import_errors", "review"] as const;
export type Task = (typeof TASKS)[number];

export const TASK_WORDS: Record<Task, string> = {
  customers: "Clients",
  properties: "Properties and service addresses",
  appointments: "Upcoming appointments",
  recurring: "Recurring service",
  team: "Cleaners and team",
  history: "Invoices and service history",
  spreadsheet_prep: "Preparing a spreadsheet",
  import_errors: "Fixing import errors",
  review: "Reviewing imported records",
};

/** Publication states. Only "published" is ever shown to an owner. */
export const STATES = ["draft", "ready_for_review", "published", "needs_update", "retired"] as const;
export type State = (typeof STATES)[number];

export const STATE_WORDS: Record<State, string> = {
  draft: "Draft",
  ready_for_review: "Ready for review",
  published: "Published",
  needs_update: "Needs update",
  retired: "Retired",
};

/** Where in the product a tutorial is offered. A screen names its placement; the catalog says what fits. */
export const PLACEMENTS = [
  "setup.source",
  "import.clients.upload",
  "import.clients.empty",
  "import.clients.unsupported",
  "import.clients.missing_columns",
  "import.properties.missing",
  "import.appointments",
  "import.recurring",
  "import.team",
  "import.history",
  "migration.review",
  "help",
] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** What the button under the player does. Every one leaves saved work as it is and imports nothing. */
export type TutorialAction =
  | { kind: "upload"; label: string; target: "clients" | "records" | "team" }
  | { kind: "template"; label: string; href: string; filename: string }
  | { kind: "open"; label: string; href: string }
  | { kind: "support"; label: string };

export type Source = { title: string; url: string; updated?: string };

export type Media = {
  /** Bumped whenever the footage or narration changes. Captions and poster carry the same version. */
  version: number;
  video: string;
  poster: string;
  captions: string;
  durationSeconds: number;
};

export type Tutorial = {
  id: string;
  platform: Platform;
  task: Task;
  title: string;
  /** One sentence: what the owner will have at the end. */
  purpose: string;
  prerequisites: string[];
  /** Who can do it in the other system, in its own words. */
  role: string;
  /** Plan limits, in the platform's own words, or null when the platform states none. */
  plan: string | null;
  steps: string[];
  /** What comes out: the file type and how it arrives. */
  format: string;
  limitations: string[];
  sources: Source[];
  /** YYYY-MM-DD: the sources were read and the steps above match them. */
  docsCheckedOn: string;
  /** YYYY-MM-DD: the steps were followed in a real account. Null until then. */
  interfaceVerifiedOn: string | null;
  /** Bumped when the written steps change. */
  contentVersion: number;
  /** The state a new deployment starts in, before staff change it. */
  defaultState: State;
  placements: Placement[];
  action: TutorialAction;
  /** The reviewed narration, which is also the transcript. Null until the narration is approved. */
  transcript: string | null;
  /** The reviewed media in this release. Staff may point a tutorial at a newer version without a release. */
  media: Media | null;
};

const SUPPORT: TutorialAction = { kind: "support", label: "Get migration help" };
const UPLOAD_CLIENTS: TutorialAction = { kind: "upload", label: "Upload your client file", target: "clients" };
const UPLOAD_RECORDS: TutorialAction = { kind: "upload", label: "Upload the file you downloaded", target: "records" };


const JOBBER_CLIENT_EXPORT: Source = { title: "Jobber: Export client information", url: "https://help.getjobber.com/hc/en-us/articles/115009619328-Export-Client-Information", updated: "2026-10-29" };
const JOBBER_REPORTS: Source = { title: "Jobber: Reports basics", url: "https://help.getjobber.com/en/articles/reports-basics", updated: "2026-10-29" };
const HCP_EXPORT: Source = { title: "Housecall Pro: How to Import & Export Jobs and Customers", url: "https://help.housecallpro.com/en/articles/6797101-how-to-import-export-jobs-and-customers", updated: "2026-07-21" };
const HCP_JOB_LIST: Source = { title: "Housecall Pro: Job & Estimate List Reporting", url: "https://help.housecallpro.com/en/articles/8241575-customers-create-jobs-estimates-reports", updated: "2026-07-16" };
const BK_CUSTOMERS: Source = { title: "BookingKoala: How to export customer data", url: "https://help.bookingkoala.com/help/how-to-export-customer-data" };
const BK_PROVIDERS: Source = { title: "BookingKoala: How to export provider data", url: "https://help.bookingkoala.com/help/how-to-export-provider-data" };
const BK_CHANGELOG: Source = { title: "BookingKoala changelog (Booking CSV export)", url: "https://feedback.bookingkoala.com/changelog/" };

const CHECKED = "2026-11-20";

export const TUTORIALS: Tutorial[] = [
  // ── Spreadsheet and Selestial (verified in Selestial itself) ──────────────────────────────────
  {
    id: "spreadsheet-prepare-clients",
    platform: "spreadsheet",
    task: "spreadsheet_prep",
    title: "Prepare a client spreadsheet for Selestial",
    purpose: "Get a .csv file of your clients that Selestial can read, with one client on each row.",
    prerequisites: ["Your client list in Excel, Google Sheets, Numbers or another spreadsheet."],
    role: "Anyone who can edit the spreadsheet. In Selestial, an Owner or Manager imports it.",
    plan: null,
    steps: [
      "Download Selestial's client template, or open your own spreadsheet.",
      "Keep one header row at the top, with one column for each detail: name, email, phone, street, city, state and ZIP.",
      "Put each client on their own row. A client with no address is still imported, without a property.",
      "Remove totals, blank rows and notes above the header.",
      "Save or download the sheet as CSV (.csv). In Google Sheets: File, Download, Comma-separated values.",
      "Return to Selestial and upload the file you just saved.",
    ],
    format: "A .csv file under 5 MB, up to 1,000 clients per file.",
    limitations: [
      "Selestial reads .csv only. An .xlsx or .numbers file must be saved as CSV first.",
      "A property is created only when street, city, state and ZIP are all present.",
      "Importing a phone number or email is not permission to text or email that person.",
    ],
    sources: [{ title: "Selestial client import (in product)", url: "/app/setup?step=records" }],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: CHECKED,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["setup.source", "import.clients.upload", "import.clients.empty", "import.clients.unsupported", "import.clients.missing_columns", "import.properties.missing", "help"],
    action: { kind: "template", label: "Download the client template", href: "/templates/selestial-clients.csv", filename: "selestial-clients.csv" },
    transcript: null,
    media: null,
  },
  {
    id: "spreadsheet-prepare-team",
    platform: "spreadsheet",
    task: "team",
    title: "Prepare a cleaner list for Selestial",
    purpose: "Get a .csv file of your cleaners that the cleaner import can read.",
    prerequisites: ["A list of your cleaners: name, and a phone or email for each."],
    role: "In Selestial, an Owner or Manager imports cleaners.",
    plan: null,
    steps: [
      "Download Selestial's cleaner template.",
      "Fill in one cleaner per row: name, employee or contractor, phone, email, service areas and skills.",
      "Separate several service areas or skills in one cell with a semicolon.",
      "Save the sheet as CSV (.csv).",
      "Return to Selestial, open Cleaners, Import, and choose the file.",
    ],
    format: "A .csv file, or rows pasted straight into the import.",
    limitations: ["Each new cleaner starts onboarding. Nobody is contacted because they were imported."],
    sources: [{ title: "Selestial cleaner import (in product)", url: "/app/cleaners/import" }],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["import.team", "help"],
    action: { kind: "template", label: "Download the cleaner template", href: "/templates/selestial-cleaners.csv", filename: "selestial-cleaners.csv" },
    transcript: null,
    media: null,
  },
  {
    id: "spreadsheet-prepare-records",
    platform: "spreadsheet",
    task: "appointments",
    title: "Prepare appointments, recurring service or history as a spreadsheet",
    purpose: "Get a .csv of visits, schedules or past invoices that Selestial can match to your clients.",
    prerequisites: ["Your clients are already imported, so each row can be matched to one."],
    role: "In Selestial, an Owner or Manager imports records.",
    plan: null,
    steps: [
      "Import your clients first.",
      "Download the template for what you are bringing in: appointments, recurring service or history.",
      "Give every row the client's name, and their email or phone, exactly as in your client list.",
      "Write dates as YYYY-MM-DD and times as HH:MM, for example 2026-12-03 and 09:30.",
      "Save the sheet as CSV (.csv), then upload it in Selestial.",
    ],
    format: "A .csv file under 5 MB, up to 1,000 rows per file.",
    limitations: ["Rows that match no client are listed for you to fix; they are never guessed.", "Imported appointments and schedules are kept for review. Nothing is booked or sent until you set it up."],
    sources: [{ title: "Selestial records import (in product)", url: "/app/setup?step=records" }],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["import.appointments", "import.recurring", "import.history", "help"],
    action: { kind: "template", label: "Download the appointments template", href: "/templates/selestial-appointments.csv", filename: "selestial-appointments.csv" },
    transcript: null,
    media: null,
  },
  {
    id: "selestial-fix-import-errors",
    platform: "spreadsheet",
    task: "import_errors",
    title: "Fix common import errors",
    purpose: "Understand why a row was held back and correct it in your file.",
    prerequisites: ["A file you have already checked in Selestial."],
    role: "An Owner or Manager.",
    plan: null,
    steps: [
      "Read the reason under each held-back row.",
      "\"It has no name\": choose the column that holds the client's name, or fill it in your file.",
      "\"The email doesn't look like an email address\": correct it, or clear the cell.",
      "\"May be an existing client\": leave it out, or tick Add anyway if it really is someone new.",
      "Fix the file, choose it again, and check it. Rows already imported are never added twice.",
    ],
    format: "The same .csv file, corrected.",
    limitations: ["Selestial never edits your file. Corrections happen in your spreadsheet."],
    sources: [{ title: "Selestial client import (in product)", url: "/app/setup?step=records" }],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: CHECKED,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["import.clients.missing_columns", "help"],
    action: SUPPORT,
    transcript: null,
    media: null,
  },
  {
    id: "selestial-review-imported",
    platform: "spreadsheet",
    task: "review",
    title: "Check your imported records",
    purpose: "Confirm what came in before any agent starts work.",
    prerequisites: ["At least one finished import."],
    role: "An Owner or Manager.",
    plan: null,
    steps: [
      "Read the import summary: how many were added, left as they were, and not imported.",
      "Open Clients and spot-check a few: name, contact details and property address.",
      "Open a client with a recurring schedule and read the schedule note brought from your old system.",
      "Fix anything wrong on the client itself. Importing again never adds the same client twice.",
    ],
    format: "Nothing to download.",
    limitations: ["Finishing setup starts no agent. Agents start only when you choose Start my agents."],
    sources: [{ title: "Selestial setup review (in product)", url: "/app/setup?step=review" }],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["migration.review", "help"],
    action: { kind: "open", label: "Open your clients", href: "/app/clients" },
    transcript: null,
    media: null,
  },

  // ── Jobber (steps from Jobber's help center; interface to be verified in a demo account) ───────
  {
    id: "jobber-export-clients",
    platform: "jobber",
    task: "customers",
    title: "Export your clients from Jobber",
    purpose: "Get a CSV of your Jobber clients, including their property addresses, to import into Selestial.",
    prerequisites: ["Sign in to Jobber on a computer.", "Have access to the email address you sign in to Jobber with."],
    role: "An admin user. Team members with the Reports permission can export some client data.",
    plan: "Jobber says client exporting is available on select plans.",
    steps: [
      "In Jobber, click Clients in the side navigation.",
      "In the top right corner, click More Actions.",
      "Select Export Clients.",
      "Under Choose export format, select CSV.",
      "Click Export. Jobber emails the file to you.",
      "Open the email, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent by email.",
    limitations: [
      "Each CSV holds up to 1,500 rows. A larger client list arrives as several files in the same email: import each one.",
      "Choosing tags exports only clients that have every selected tag.",
    ],
    sources: [JOBBER_CLIENT_EXPORT],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["setup.source", "import.clients.upload", "import.clients.empty", "import.clients.unsupported", "import.properties.missing", "help"],
    action: UPLOAD_CLIENTS,
    transcript: null,
    media: null,
  },
  {
    id: "jobber-export-visits",
    platform: "jobber",
    task: "appointments",
    title: "Export upcoming visits from Jobber",
    purpose: "Get a CSV of your scheduled Jobber visits, with dates, clients and service addresses.",
    prerequisites: ["Import your Jobber clients first, so each visit can be matched to a client."],
    role: "An admin, or a user with View full client and property info, View all clients, View all jobs, Show pricing and View reports.",
    plan: "Jobber says reports are available on select plans.",
    steps: [
      "In Jobber, select Insights in the side navigation, then Reports.",
      "Under Work reports, select Visits.",
      "Set the date filter to the upcoming weeks you want to bring in.",
      "Click Export to CSV and choose all columns.",
      "Open the email from Jobber, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent to the email you sign in with.",
    limitations: ["Scheduled duration is in hours as a decimal (0.5 is half an hour)."],
    sources: [{ title: "Jobber: Visits report", url: "https://help.getjobber.com/en/articles/visits-report/", updated: "2026-10-29" }, JOBBER_REPORTS],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["import.appointments", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },
  {
    id: "jobber-export-recurring",
    platform: "jobber",
    task: "recurring",
    title: "Export recurring jobs from Jobber",
    purpose: "Get a CSV of your recurring Jobber jobs with each one's visit frequency and schedule dates.",
    prerequisites: ["Import your Jobber clients first."],
    role: "An admin, or a user with View all jobs, View reports and Show pricing.",
    plan: "Jobber says reports are available on select plans.",
    steps: [
      "In Jobber, select Insights in the side navigation, then Reports.",
      "Under Work reports, select Recurring jobs.",
      "Click Columns and make sure Visit frequency, Schedule start date and Schedule end date are shown.",
      "Click Export to CSV.",
      "Open the email from Jobber, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent to the email you sign in with.",
    limitations: ["Job costing is not in this report."],
    sources: [{ title: "Jobber: Recurring Jobs Report", url: "https://help.getjobber.com/hc/en-us/articles/20440772134807-Recurring-Jobs-Report", updated: "2026-11-12" }, JOBBER_REPORTS],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["import.recurring", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },
  {
    id: "jobber-export-invoices",
    platform: "jobber",
    task: "history",
    title: "Export invoices from Jobber",
    purpose: "Get a CSV of past Jobber invoices to keep as each client's history in Selestial.",
    prerequisites: ["Import your Jobber clients first."],
    role: "An admin, or a user with the Reports permission.",
    plan: "Jobber says reports are available on select plans.",
    steps: [
      "In Jobber, select Insights in the side navigation, then Reports.",
      "Under Financial reports, select Invoices.",
      "Choose the date range you want to keep.",
      "Click Email CSV.",
      "Open the email from Jobber, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent to the email you sign in with.",
    limitations: ["History is kept for reference only. Selestial does not collect or re-send these invoices."],
    sources: [{ title: "Jobber: Invoice and payment reports", url: "https://help.getjobber.com/en/articles/invoice-and-payment-reports", updated: "2026-10-29" }, JOBBER_REPORTS],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["import.history", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },

  // ── Housecall Pro ────────────────────────────────────────────────────────────────────────────
  {
    id: "hcp-export-customers",
    platform: "housecall_pro",
    task: "customers",
    title: "Export your customers from Housecall Pro",
    purpose: "Get a CSV of your Housecall Pro customers to import into Selestial.",
    prerequisites: ["Sign in to Housecall Pro on a computer.", "Have access to your email."],
    role: "Only employees listed as Admins can export the Customers list.",
    plan: null,
    steps: [
      "In Housecall Pro, select Customers in the left navigation bar.",
      "Click Actions on the right side.",
      "Select Export.",
      "Confirm your email address, then click Send file.",
      "Open the email from notifications@housecallpro.com, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent by email.",
    limitations: ["If the email has not arrived within an hour, check your spam folder."],
    sources: [HCP_EXPORT],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["setup.source", "import.clients.upload", "import.clients.empty", "import.clients.unsupported", "import.properties.missing", "help"],
    action: UPLOAD_CLIENTS,
    transcript: null,
    media: null,
  },
  {
    id: "hcp-export-jobs",
    platform: "housecall_pro",
    task: "appointments",
    title: "Export scheduled jobs from Housecall Pro",
    purpose: "Get a CSV of your upcoming Housecall Pro jobs to bring their dates into Selestial.",
    prerequisites: ["Import your Housecall Pro customers first."],
    role: "Only employees listed as Admins can export the Jobs list.",
    plan: null,
    steps: [
      "In Housecall Pro, click Jobs in the left navigation bar.",
      "Click Edit columns and include the customer, the scheduled date and the address.",
      "Click Filter, set the scheduled date to the upcoming weeks, then click Apply.",
      "Click Actions in the top right, then Export, then Send file.",
      "Open the email, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent to the email you sign in with.",
    limitations: ["The export follows the columns and filters you chose on the Jobs list."],
    sources: [HCP_JOB_LIST, HCP_EXPORT],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["import.appointments", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },
  {
    id: "hcp-export-recurring",
    platform: "housecall_pro",
    task: "recurring",
    title: "Export recurring jobs from Housecall Pro",
    purpose: "Get a CSV of your Housecall Pro jobs that shows which ones recur.",
    prerequisites: ["Import your Housecall Pro customers first."],
    role: "Only employees listed as Admins can export the Jobs list.",
    plan: null,
    steps: [
      "In Housecall Pro, click Jobs in the left navigation bar.",
      "Click Edit columns and turn on Recurring, along with the customer and scheduled date.",
      "Click Actions in the top right, then Export, then Send file.",
      "Open the email, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent to the email you sign in with.",
    limitations: ["Housecall Pro's help center does not describe how often each job repeats in the export. Check each schedule in Selestial before setting it up."],
    sources: [HCP_JOB_LIST],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["import.recurring", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },
  {
    id: "hcp-export-invoices",
    platform: "housecall_pro",
    task: "history",
    title: "Export jobs and invoices from Housecall Pro",
    purpose: "Get a CSV of past Housecall Pro jobs and invoices to keep as each customer's history.",
    prerequisites: ["Import your Housecall Pro customers first."],
    role: "Only employees listed as Admins can export the Jobs list.",
    plan: null,
    steps: [
      "In Housecall Pro, click Jobs in the left navigation bar.",
      "Click Filter, set the completed date range you want to keep, then click Apply.",
      "Click Actions in the top right, then Export, then Send file.",
      "Open the email, download the CSV, then return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV, sent by email. Jobs and invoices come in the same file.",
    limitations: ["History is kept for reference only. Selestial does not collect or re-send these invoices."],
    sources: [HCP_EXPORT, HCP_JOB_LIST],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "ready_for_review",
    placements: ["import.history", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },

  // ── BookingKoala (help center could not be read from Selestial's servers; to be verified) ──────
  {
    id: "bk-export-customers",
    platform: "bookingkoala",
    task: "customers",
    title: "Export your customers from BookingKoala",
    purpose: "Get a CSV of your BookingKoala customers to import into Selestial.",
    prerequisites: ["Sign in to your BookingKoala admin dashboard on a computer."],
    role: "To be confirmed in a BookingKoala account.",
    plan: null,
    steps: [
      "In BookingKoala, open Customers, then Customers.",
      "Click Export.",
      "Choose the customers to include (for example active customers) and the fields to export.",
      "Export, then download the file from the link BookingKoala emails you.",
      "Return to Selestial and upload the file you just downloaded.",
    ],
    format: "CSV. BookingKoala's changelog says exports are emailed with a download link.",
    limitations: ["Not yet checked against BookingKoala's own help article or a real account."],
    sources: [BK_CUSTOMERS, BK_CHANGELOG],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["setup.source", "import.clients.upload", "import.clients.empty", "import.clients.unsupported", "help"],
    action: UPLOAD_CLIENTS,
    transcript: null,
    media: null,
  },
  {
    id: "bk-export-providers",
    platform: "bookingkoala",
    task: "team",
    title: "Export your providers from BookingKoala",
    purpose: "Get a CSV of your BookingKoala providers to import as cleaners.",
    prerequisites: ["Sign in to your BookingKoala admin dashboard on a computer."],
    role: "To be confirmed in a BookingKoala account.",
    plan: null,
    steps: [
      "In BookingKoala, open Providers, then Providers.",
      "Click Export and choose the providers and fields.",
      "Download the file, then return to Selestial, open Cleaners, Import, and choose it.",
    ],
    format: "CSV.",
    limitations: ["Not yet checked against BookingKoala's own help article or a real account."],
    sources: [BK_PROVIDERS],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["import.team", "help"],
    action: { kind: "upload", label: "Import your cleaners", target: "team" },
    transcript: null,
    media: null,
  },
  {
    id: "bk-export-bookings",
    platform: "bookingkoala",
    task: "appointments",
    title: "Export bookings from BookingKoala",
    purpose: "Get BookingKoala's booking CSV, with each booking's date, customer and occurrence.",
    prerequisites: ["Import your BookingKoala customers first."],
    role: "To be confirmed in a BookingKoala account.",
    plan: null,
    steps: ["To be written once the booking export is found and followed in a BookingKoala account."],
    format: "CSV. BookingKoala's changelog lists Booking Start/End Date Time, Location Details, Occurrence and City among its columns.",
    limitations: ["BookingKoala's help center does not say where the booking export is. Not verified."],
    sources: [BK_CHANGELOG],
    docsCheckedOn: CHECKED,
    interfaceVerifiedOn: null,
    contentVersion: 1,
    defaultState: "draft",
    placements: ["import.appointments", "import.recurring", "help"],
    action: UPLOAD_RECORDS,
    transcript: null,
    media: null,
  },
];

/**
 * Tasks a platform has no documented export for. The owner is told so plainly and offered the spreadsheet
 * route instead of a tutorial that would not work.
 */
export const NO_EXPORT: Partial<Record<Platform, Partial<Record<Task, string>>>> = {
  jobber: { team: "Jobber's help center has no export for team members. Use the cleaner template instead." },
  housecall_pro: { team: "Housecall Pro's help center has no export for employees. Use the cleaner template instead." },
};

const BY_ID = new Map(TUTORIALS.map((tutorial) => [tutorial.id, tutorial]));

export function tutorialById(id: string): Tutorial | undefined {
  return BY_ID.get(id);
}

/** Which platform a placement is about, from what the owner chose or the file they gave. */
export function matches(tutorial: Tutorial, placement: Placement, platform: Platform | null): boolean {
  if (!tutorial.placements.includes(placement)) return false;
  if (placement === "help") return true;
  // Selestial's own tutorials (fixing errors, reviewing) fit any source; export tutorials only their own.
  if (tutorial.platform === "spreadsheet") return platform === null || platform === "spreadsheet" || tutorial.task === "import_errors" || tutorial.task === "review" || tutorial.task === "team";
  return tutorial.platform === platform;
}
