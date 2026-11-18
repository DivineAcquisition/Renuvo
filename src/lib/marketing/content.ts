/**
 * Every word on the public site. Screens read from here so copy changes in one place.
 *
 * Selestial is in development. Nothing here states a customer result, and every product
 * picture on the page is labelled as an example.
 */

export const TAGLINE = "The AI operating platform for cleaning companies.";

export const SITE_DESCRIPTION =
  "Selestial is the AI operating platform for cleaning companies. Four coordinated agents for sales, recruiting, dispatch and retention move the daily work forward within the standards you set.";

/** Where the operations assessment lives. Every "Get early access" button goes here. */
export const ASSESSMENT_PATH = "/assessment";

export const NAV = {
  links: [
    { href: "#agents", label: "The agents" },
    { href: "#how-it-works", label: "How it works" },
    { href: "#pricing", label: "Pricing" },
    { href: "#philosophy", label: "Our philosophy" },
  ],
  cta: "Get early access",
  openMenu: "Open menu",
  skipToContent: "Skip to content",
} as const;

export const EXAMPLE_LABEL = "Example";

export const HERO = {
  eyebrow: "The AI operating platform for cleaning companies",
  headline: "Your business shouldn’t wait on you for everything.",
  supporting:
    "Meet your AI team for sales, recruiting, dispatch, and retention. Selestial is being built to move the daily work forward—from following up with a new inquiry to keeping a recurring customer—within the standards you set.",
  primaryCta: "Get early access",
  secondaryCta: "Meet your AI team",
  trust: "Four coordinated agents. Clear responsibilities. You stay in control.",
} as const;

export type AgentId = "sales" | "recruiter" | "dispatch" | "retention";

export const AGENTS: ReadonlyArray<{ id: AgentId; name: string; headline: string; body: string; outcome: string }> = [
  {
    id: "sales",
    name: "Sales",
    headline: "Keep the next booking moving.",
    body: "Give every inquiry a clear next step. Your Sales agent helps collect cleaning requirements, prepare quotes within your pricing rules, follow up with prospects, and coordinate bookings around available capacity.",
    outcome: "From first inquiry to a booking you can fulfill.",
  },
  {
    id: "recruiter",
    name: "Recruiter",
    headline: "Build the team your schedule needs.",
    body: "Keep applicants moving through the process. Your Recruiter helps collect details, check your requirements, coordinate interviews, and track onboarding—so you can make informed hiring decisions.",
    outcome: "From interested applicant to an approved, ready cleaner.",
  },
  {
    id: "dispatch",
    name: "Dispatch",
    headline: "Give every job a clear plan.",
    body: "Connect booked work with the people available to deliver it. Your Dispatch agent helps coordinate assignments, request cleaner acceptance, track coverage, and surface scheduling problems before they become customer surprises.",
    outcome: "From booked service to confirmed coverage and completion.",
  },
  {
    id: "retention",
    name: "Retention",
    headline: "Give customers a reason to stay.",
    body: "Keep the relationship moving after the clean. Your Retention agent helps follow up on service, flag concerns, introduce recurring options, and reconnect with customers who have gone quiet.",
    outcome: "From completed clean to the next reason to book.",
  },
];

/** The hero picture: the owner's home screen. Every figure and line in it is made up. */
export const HOME_SCREEN = {
  window: "Today",
  serviceTitle: "Today’s service",
  service: [
    { label: "Confirmed", value: "9" },
    { label: "Underway", value: "3" },
    { label: "Completed", value: "2" },
    { label: "At risk", value: "0" },
  ],
  agentsTitle: "Agents working",
  agents: [
    { agent: "sales", statuses: ["Following up on a quote", "Collecting cleaning details", "Checking capacity"] },
    { agent: "recruiter", statuses: ["Tracking onboarding", "Coordinating an interview", "Checking requirements"] },
    { agent: "dispatch", statuses: ["Requesting acceptance", "Confirming coverage", "Watching tomorrow"] },
    { agent: "retention", statuses: ["Collecting feedback", "Following up on a concern", "Offering a recurring plan"] },
  ],
  items: [
    { state: "resolved", label: "Resolved", agent: "dispatch", body: "Tomorrow’s uncovered visit now has an accepted replacement." },
    { state: "progress", label: "In progress", agent: "sales", body: "Three qualified inquiries are awaiting customer responses; follow-ups are scheduled." },
    { state: "decision", label: "Needs your decision", agent: "retention", body: "A customer requested compensation beyond your authorized limit." },
    { state: "concern", label: "Capacity concern", agent: "recruiter", body: "Upcoming recurring work exceeds confirmed cleaner availability; recruiting needs attention." },
  ],
} as const;

export const PROBLEM = {
  id: "problem",
  headline: "The cleaning ends. The work keeps coming.",
  looseEnds: [
    { agent: "sales", text: "A quote needs another follow-up." },
    { agent: "recruiter", text: "An applicant hasn’t finished onboarding." },
    { agent: "dispatch", text: "Tomorrow’s job needs a cleaner." },
    { agent: "retention", text: "A regular customer hasn’t booked again." },
  ],
  together: "Each task seems small. Together, they keep the business dependent on your attention.",
  answer:
    "Selestial is designed to carry those responsibilities forward, keep track of what remains unresolved, and bring you the decisions that need your judgment.",
} as const;

export const AGENTS_SECTION = {
  id: "agents",
  headline: "Four responsibilities. One coordinated team.",
} as const;

export const COORDINATION = {
  id: "how-it-works",
  headline: "Because one change affects the whole business.",
  lead: "A cleaner cancels tomorrow. The response should reach everyone it affects.",
  intro: "An example of the workflow we’re building:",
  event: { label: "What changed", title: "A cleaner cancels tomorrow’s visit." },
  responses: [
    { agent: "dispatch", title: "Dispatch works on coverage.", body: "It checks eligible replacements, requests acceptance, and flags the job if coverage remains unresolved." },
    { agent: "sales", title: "Sales works with updated availability.", body: "New bookings reflect the capacity your company can actually offer." },
    { agent: "retention", title: "Retention keeps the customer’s history in view.", body: "Previous service issues inform whether the customer needs extra attention." },
    { agent: "recruiter", title: "Recruiter sees recurring staffing gaps.", body: "Persistent shortages become a clear recruiting priority." },
  ],
  reached: "Reached",
  waiting: "Next",
  closing: "You can see what happened, what is being handled, and where a decision is needed.",
} as const;

export const CONTROL = {
  id: "control",
  headline: "Your standards guide every agent.",
  cards: [
    { id: "boundaries", title: "Set the boundaries.", body: "Define services, prices, availability, service areas, and the actions that require your approval." },
    { id: "delegate", title: "Choose what to delegate.", body: "Review proposed actions first. Allow specific routine tasks to run automatically as you gain confidence." },
    { id: "follow", title: "See the follow-through.", body: "Understand what each agent did, what happened next, and what remains open." },
    { id: "step-in", title: "Step in when it matters.", body: "Take over a conversation, change a decision, or pause an agent when circumstances call for it." },
  ],
  dial: {
    title: "Choose what to delegate",
    actionLabel: "Action",
    levelLabel: "Permission",
    actions: [
      { id: "accept", agent: "dispatch", label: "Request acceptance from a cleaner" },
      { id: "quote", agent: "sales", label: "Follow up on an unanswered quote" },
      { id: "feedback", agent: "retention", label: "Request feedback after a visit" },
      { id: "details", agent: "recruiter", label: "Ask an applicant for missing details" },
    ],
    levels: [
      { id: "off", label: "Off", body: "The agent does not do this." },
      { id: "propose", label: "Propose", body: "The agent prepares the action and its reason. You approve, change or skip it." },
      { id: "report", label: "Execute and report", body: "The agent acts and tells you each time." },
      { id: "execute", label: "Execute", body: "The agent acts. It appears in the action history." },
    ],
    note: "Each permission is separate. Allowing a reminder does not allow a discount or a change to an assignment.",
  },
  decision: {
    title: "Needs your decision",
    request: "A customer requested compensation beyond your authorized limit.",
    meta: "Retention · brought to you because it is above the limit you set",
    hold: "Hold to approve",
    holding: "Keep holding",
    hint: "Hold the button for a moment. This is an example and changes nothing.",
    approvedTitle: "Approved",
    approvedBody: "Retention carries it out and records who decided.",
    reset: "Reset",
    waiting: "Waiting",
    approved: "Approved",
  },
} as const;

export const PHILOSOPHY = {
  id: "philosophy",
  eyebrow: "Our philosophy",
  headline: "Own the business. Have room to lead it.",
  paragraphs: [
    "We believe a cleaning company should be able to grow without requiring its owner to personally hold every part together.",
    "That starts with clear responsibilities and dependable follow-through.",
    "For Selestial, sending a message is only a step. The work continues until there is a confirmed result, a clear next action, or a decision brought back to you.",
  ],
  closing: "You set the standard. Selestial carries the work forward.",
} as const;

/**
 * Public pricing. The plans and prices are approved; credit allowances are not, so none is shown. Every
 * agent and feature that is not working today says so.
 */
export const PRICING = {
  id: "pricing",
  eyebrow: "Pricing",
  headline: "The right AI workforce for your cleaning company.",
  lead: "Start with four essential agents. Expand into a complete team as your operation grows.",
  plans: [
    {
      id: "operate",
      name: "Operate",
      price: "$299",
      period: "/month",
      summary: "Keep sales, hiring, dispatch, and retention moving from one workspace.",
      today: ["Dispatch: offers, coverage, live jobs and cleaner text-message links", "Recruiter: your hiring inbox, invitations, applications, interviews and offers", "Company Chat", "Agreements, templates and AI-guided drafting", "A monthly allowance of Selestial Credits for AI work"],
      later: ["Sales and Retention, included when released"],
    },
    {
      id: "expand",
      name: "Expand",
      price: "$499",
      period: "/month",
      summary: "Add marketing, quality, customer care, and team coordination, with customer portals and advanced controls.",
      today: ["Everything in Operate", "Creative Studio for images and video", "Advanced approval routing and template governance for agreements", "A larger monthly credit allowance"],
      later: ["Marketing, Quality, Customer Care and Team Coordinator, included when released", "Customer portal, your own domain for booking pages, advanced workflow customization, and team and location governance, when available"],
    },
  ],
  allowanceNote: "Each plan includes a monthly allowance of Selestial Credits, and Expand includes twice Operate's. Your Usage page shows your allowance, what each piece of AI work costs, and what used it.",
  services: "Bespoke implementation, migration and custom development are scoped separately.",
  faqs: [
    { q: "Which agents does each plan include?", a: "Operate includes Sales, Retention, Recruiter and Dispatch. Expand adds Marketing, Quality, Customer Care and Team Coordinator. Today Dispatch and Recruiter are working; the others are included in their plan when each is released, and no plan or purchase makes one available sooner." },
    { q: "What uses credits?", a: "Selestial Credits pay for defined AI work, such as one Company Chat answer, one hiring email read by AI, or one generated image. Each is charged once when it is completed. Viewing records, opening or answering a cleaner’s link, accepting a job, status changes and scheduled reminders use no credits." },
    { q: "What happens when credits run out?", a: "New AI work pauses and the Owner is told. Schedules, records, cleaner links, active jobs and everything that does not use AI keep working. Nothing is bought automatically; you can buy a top-up or wait for the monthly reset." },
    { q: "Do top-ups unlock agents?", a: "No. A top-up adds credits only. Agents and features come with the plan, and only once they are released." },
    { q: "How do monthly credits reset?", a: "Included credits reset at the start of each billing period and do not roll over. Purchased credits are used after the included ones, do not reset, and can be used while you have an active plan." },
    { q: "How is texting and calling charged?", a: "Text messages, calls and other outside services are measured separately from credits and priced openly. When AI writes a message that is then sent, the AI work and the message are shown as separate items." },
    { q: "How do upgrades, downgrades and cancellation work?", a: "Upgrading shows the exact charge and takes effect once payment is confirmed; credits already used this month still count. Downgrading takes effect at renewal and lists what you would lose first; your records, completed work and signed agreements are kept. Cancelling stops the renewal, and the plan stays active until the end of the period you paid for." },
  ],
} as const;

export const FINAL_CTA = {
  id: "early-access",
  headline: "Find out what your cleaning business can delegate.",
  paragraphs: [
    "Tell us how your company operates. We’ll assess where Selestial could support sales, recruiting, dispatch, and retention—and what setup or migration would involve.",
  ],
  cta: "Start the assessment",
  note: "Seven short questions and your contact details.",
} as const;

export const ASSESSMENT_PAGE = {
  title: "Operations assessment",
  eyebrow: "Operations assessment",
  headline: FINAL_CTA.headline,
  lead: FINAL_CTA.paragraphs[0],
  back: "Back to Selestial",
} as const;

/**
 * The operations assessment. Each option is [stored answer, the words shown]; the stored answers are the
 * lists in convex/lib/assessment.ts, and a test keeps the two in step.
 */
export const EARLY_ACCESS = {
  title: "Request an operations assessment",
  questions: [
    { name: "role", label: "What best describes you?", options: [["owner", "Owner / co-owner"], ["operations_manager", "Operations manager"], ["other", "Other"]] },
    {
      name: "businessType",
      label: "What type of cleaning business do you operate?",
      options: [["residential", "Residential"], ["commercial", "Commercial"], ["short_term_rental", "Short-term rental / turnover"], ["combination", "A combination"]],
    },
    { name: "cleaners", label: "How many cleaners actively work with your company?", options: [["just_me", "Just me"], ["1_4", "1–4"], ["5_14", "5–14"], ["15_29", "15–29"], ["30_plus", "30+"]] },
    {
      name: "monthlyCleans",
      label: "Approximately how many cleans do you complete each month?",
      options: [["under_20", "Fewer than 20"], ["20_49", "20–49"], ["50_149", "50–149"], ["150_299", "150–299"], ["300_plus", "300+"]],
    },
    {
      name: "bookingTool",
      label: "What do you currently use to manage bookings?",
      options: [["jobber", "Jobber"], ["housecall_pro", "Housecall Pro"], ["bookingkoala", "BookingKoala"], ["gohighlevel", "GoHighLevel"], ["another_platform", "Another platform"], ["manual", "Spreadsheets / calendar / mostly manual"]],
    },
    {
      name: "help",
      label: "Which responsibility needs the most help?",
      options: [
        ["sales", "Responding to inquiries and following up on quotes"],
        ["recruiting", "Recruiting and onboarding cleaners"],
        ["dispatch", "Assigning jobs and finding replacement coverage"],
        ["retention", "Keeping customers and increasing recurring bookings"],
      ],
    },
    {
      name: "openTo",
      label: "If there’s a fit, what are you open to?",
      options: [["test_one_workflow", "Testing one workflow alongside my current system"], ["broader_move", "Planning a broader move to Selestial"], ["explore_later", "Exploring options for later"]],
    },
  ],
  contactTitle: "Contact details",
  fields: {
    name: "Full name",
    company: "Company name",
    email: "Email",
    phone: "Phone",
    website: "Website or business page",
  },
  /** The questions shown as a dropdown. The others are a short row of choices. */
  dropdowns: ["businessType", "cleaners", "monthlyCleans", "bookingTool"],
  choose: "Select one",
  /** Its own box, unticked. Permission to text is always the person's choice, so it is never needed to submit. */
  smsConsent: "It’s OK to text me at this number about my assessment.",
  submit: "Request My Operations Assessment",
  sending: "Sending",
  consent: "Submitting requests contact about your assessment.",
  done: { title: "Request received.", body: "We’ll be in touch about your operations assessment." },
  errors: {
    invalid: "Answer all seven questions and check your name, company name, email, phone and website or business page, then try again.",
    closed: "Assessment requests are not open yet. Please check back soon.",
    failed: "That did not go through. Please try again in a moment.",
    limited: "Too many requests came from this connection. Please try again in an hour.",
  },
} as const;

export const FOOTER = {
  name: "Selestial",
  tagline: TAGLINE,
  roles: ["Sales", "Recruiting", "Dispatch", "Retention"],
  note: "Selestial is in development. Product screens on this page are examples of the design, with made-up names and figures.",
} as const;

/** Small pictures inside each agent card. Every name, price and time is made up. */
export const AGENT_VISUALS = {
  sales: {
    kind: "chat",
    title: "New inquiry",
    rows: [
      { who: "them", text: "3 bed, 2 bath, and a very dirty oven. Friday?" },
      { who: "agent", text: "Quote from your pricing rules: $285, oven included." },
      { who: "agent", text: "Friday 9:00 has confirmed capacity." },
      { who: "state", text: "Waiting on reply · follow-up set for tomorrow" },
    ],
  },
  recruiter: {
    kind: "stages",
    title: "Applicant: Dana K.",
    rows: [
      { text: "Application received" },
      { text: "Meets your requirements" },
      { text: "Interview coordinated" },
      { text: "Onboarding: 4 of 6 steps" },
      { text: "Sent to you for approval" },
    ],
  },
  dispatch: {
    kind: "rank",
    title: "Thursday 9:00 · needs a cleaner",
    rows: [
      { text: "Maria R.", detail: "Usual cleaner · 4 miles", state: "Accepted" },
      { text: "Priya S.", detail: "Available · 6 miles", state: "Next" },
      { text: "Jo T.", detail: "Not enough time between jobs", state: "Ruled out" },
    ],
  },
  retention: {
    kind: "stages",
    title: "After the visit",
    rows: [
      { text: "Visit completed and verified" },
      { text: "Feedback requested" },
      { text: "Concern raised: missed oven" },
      { text: "Re-clean agreed, issue closed" },
      { text: "Recurring plan offered" },
    ],
  },
} as const;

/** The philosophy picture: one task followed until it reaches a clear state. */
export const TASK_TRAIL = {
  title: "One task, followed through",
  task: "Quote for a 3-bedroom home",
  steps: [
    { label: "Quote sent", note: "An action, not a result." },
    { label: "Waiting on reply", note: "Follow-up set for Thursday." },
    { label: "Followed up", note: "No answer by the deadline." },
    { label: "Customer replied", note: "Asked for a later start." },
    { label: "Booked", note: "Capacity confirmed. Task closed." },
  ],
  fields: { owner: "Owner", ownerValue: "Sales", next: "Next action", deadline: "Deadline", closed: "Closed" },
} as const;

/**
 * The connections planned for launch. None is live yet, and the page says so. `icon` is a file in
 * public/brand/integrations; a connection with no icon file shows its initial instead.
 */
export const INTEGRATIONS = {
  id: "connections",
  headline: "Works with the tools you already use.",
  lead: "Selestial is being built to connect to the places your leads, applicants, calendar and payments already live.",
  status: "Planned",
  groups: [
    {
      title: "Leads",
      items: [
        { name: "Meta lead ads", icon: "meta", body: "New leads from Facebook and Instagram go straight to Sales." },
        { name: "Google Ads", icon: "google-ads", body: "Leads from your ads arrive with their source attached." },
        { name: "Google reviews", icon: "google", body: "Retention invites every customer to leave a review." },
      ],
    },
    {
      title: "Hiring",
      items: [
        { name: "Indeed", icon: "indeed", body: "Recruiter reads new applications from your hiring inbox." },
        { name: "ZipRecruiter", icon: null, body: "Recruiter reads new applications from your hiring inbox." },
        { name: "Gmail", icon: "gmail", body: "Connect the mailbox your applications arrive in." },
        { name: "Outlook", icon: "outlook", body: "Connect the mailbox your applications arrive in." },
      ],
    },
    {
      title: "Scheduling",
      items: [
        { name: "Google Calendar", icon: "google-calendar", body: "Interviews and visits appear on the calendar you already keep." },
        { name: "Google Maps", icon: "googlemaps", body: "Real travel time between jobs, so the day is one cleaners can keep." },
      ],
    },
    {
      title: "Money",
      items: [
        { name: "Stripe", icon: "stripe", body: "Deposits, balances, plans and cleaner payouts." },
        { name: "QuickBooks", icon: "quickbooks", body: "Charges and payouts sent to your books." },
      ],
    },
  ],
  note: "Planned connections. None is live yet. Names and logos belong to their owners.",
} as const;
