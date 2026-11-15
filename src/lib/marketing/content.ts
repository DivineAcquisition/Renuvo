/**
 * Every word on the public site. Screens read from here so copy changes in one place.
 *
 * Renuvo is in development. Nothing here states a customer result, and every product
 * picture on the page is labelled as an example.
 */

export const SITE_DESCRIPTION =
  "Renuvo is the agentic platform for cleaning companies. Four agents answer leads, staff jobs, keep customers and build the roster. You set the rules and approve what matters.";

export const NAV = {
  links: [
    { href: "#agents", label: "Agents" },
    { href: "#loop", label: "How it works" },
    { href: "#control", label: "Control" },
    { href: "#who", label: "Who it is for" },
    { href: "#faq", label: "Questions" },
  ],
  book: "Book a call",
  waitlist: "Join the waitlist",
  openMenu: "Open menu",
  skipToContent: "Skip to content",
} as const;

export const HERO = {
  label: "Renuvo",
  headline: "The agentic platform for cleaning companies.",
  supporting:
    "Four agents answer every lead, staff every job, keep your customers and build your roster. You set the rules. They do the work and bring you only what needs a person.",
  primaryCta: "Book a call",
  secondaryCta: "Join the waitlist",
  trust: "In development. Early access opens to a small group of cleaning companies first.",
  exampleLabel: "Example",
} as const;

export type AgentId = "vera" | "atlas" | "scout" | "loop";

export const AGENTS: ReadonlyArray<{
  id: AgentId;
  name: string;
  role: string;
  job: string;
  steps: readonly string[];
  never: string;
  number: string;
}> = [
  {
    id: "vera",
    name: "Vera",
    role: "Sales",
    job: "Turns a stranger into a paid first booking.",
    steps: [
      "Replies inside a minute, on the channel the lead used.",
      "Asks only what the price needs.",
      "Quotes from your pricing rules, with a reason for every line.",
      "Books a time your team can staff and takes the deposit by secure link.",
      "Follows up until booked, lost or opted out.",
    ],
    never: "Never quotes a price your rules did not produce.",
    number: "Leads booked, and time to first reply",
  },
  {
    id: "atlas",
    name: "Atlas",
    role: "Dispatch",
    job: "Gets every booked job staffed, done to standard and closed.",
    steps: [
      "Lists the cleaners who can do the job, with travel and time between jobs counted.",
      "Ranks them and sends offers that show each cleaner their own pay.",
      "Watches check-ins and tells customers early when a visit will run late.",
      "Finds cover when someone drops out.",
      "Checks the checklist and photos before a job is closed.",
    ],
    never: "Never books a cleaner into a time they cannot make.",
    number: "Jobs staffed without a person, and on-time arrival",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Recruiter",
    job: "Keeps your roster large enough and good enough for the work.",
    steps: [
      "Takes hiring targets from the gaps Atlas reports, by area and day.",
      "Screens applicants against the fixed requirements you publish.",
      "Runs a structured interview and keeps each answer beside its score.",
      "Gives you a ranked shortlist. You decide who moves forward.",
      "Chases every onboarding step until the cleaner is ready for a first job.",
    ],
    never: "Never rejects a person on its own judgment.",
    number: "Cleaners activated, and days to first job",
  },
  {
    id: "loop",
    name: "Loop",
    role: "Retention",
    job: "Keeps customers paying and grows what each one is worth.",
    steps: [
      "Follows up after every visit and invites everyone to leave a review.",
      "Opens a case for anyone unhappy and proposes a remedy by your guarantee.",
      "Offers a recurring plan after a good first visit.",
      "Recovers failed payments with a card-update link.",
      "Wins back customers who have gone quiet.",
    ],
    never: "Never makes it hard to cancel.",
    number: "Customers kept, and one-time customers moved to a plan",
  },
];

export const AGENTS_SECTION = {
  id: "agents",
  eyebrow: "The four agents",
  headline: "One job each. One promise each.",
  lead: "Each agent owns one outcome and is measured on a number you already care about. Each one tells customers and applicants it is an AI assistant for your company.",
  jobLabel: "The job",
  neverLabel: "The promise",
  numberLabel: "Measured on",
  planned: {
    title: "Planned next",
    note: "The platform is designed for more agents on the same record. These are planned and not built.",
    items: [
      { name: "Quality", body: "Checklists, inspections, complaint cases and coaching." },
      { name: "Books", body: "Invoices, pay runs, tax forms and the profit view." },
      { name: "Marketing", body: "Ads, reviews, referrals and local search." },
    ],
  },
} as const;

/** What wakes an agent. Shown as the left side of the strip under the hero. */
export const EVENTS = {
  label: "What starts the work",
  items: [
    { key: "lead", label: "A lead arrives" },
    { key: "booked", label: "A job is booked" },
    { key: "dropped", label: "A cleaner drops a job" },
    { key: "failed", label: "A payment fails" },
    { key: "done", label: "A visit is completed" },
    { key: "applied", label: "Someone applies" },
  ],
  hub: { role: "Your agents", name: "Renuvo" },
  statuses: [
    "Vera is replying to a new lead",
    "Atlas is finding cover for Thursday",
    "Loop is sending a card-update link",
    "Scout is scoring an interview",
  ],
  output: {
    title: "Thursday 9:00 clean is staffed",
    meta: "Offer accepted. Customer and crew confirmed.",
    state: "Done and reported",
  },
  caption: "No one has to click anything. An event wakes the agent that owns the next step.",
} as const;

export const PROBLEM = {
  id: "problem",
  headline: "Your software records the day. You still run it.",
  opening:
    "A cleaning company runs on a hundred small decisions a day. Who answers the lead. Who takes the job. Who covers when someone calls out. Who chases the card that failed.",
  bridge:
    "Scheduling software stores the answers. Someone still has to make them. Renuvo makes the ones that can be made by rule, carries them out and shows its reasons.",
  pains: [
    { title: "Leads wait", body: "A lead that waits an hour for a reply has usually called someone else." },
    { title: "Staffing is phone calls", body: "Every job is a round of texts to find who is free, near and willing." },
    { title: "Call-outs wreck the day", body: "One cleaner drops out and the afternoon is spent rebuilding it." },
    { title: "Customers leave quietly", body: "A failed card or a missed follow-up ends a plan without anyone noticing." },
  ],
} as const;

export const LOOP = {
  id: "loop",
  eyebrow: "One loop",
  headline: "Four agents, one record, no gaps between them.",
  lead: "Customers, properties, jobs, cleaners, money and conversations live in one place. When one agent finishes a step, the next one already knows.",
  handoffs: [
    { from: "vera", to: "atlas", body: "A paid booking becomes a job. Vera only offers times Atlas can staff." },
    { from: "atlas", to: "scout", body: "Jobs that could not be staffed become hiring targets, by area and day." },
    { from: "scout", to: "atlas", body: "New cleaners arrive ready for a first job." },
    { from: "atlas", to: "loop", body: "Each finished visit arrives with its checklist and photos." },
    { from: "loop", to: "atlas", body: "Re-cleans go back as jobs. A customer keeps the cleaner they like." },
    { from: "loop", to: "vera", body: "Referrals and win-back replies come back as new leads." },
  ],
  thread: {
    title: "One conversation per person",
    body: "Every text, email and call with a customer sits in one thread. One send gate checks consent, quiet hours and how often you have already been in touch, so two agents never message the same person about different things on one afternoon.",
  },
} as const;

export const CONTROL = {
  id: "control",
  eyebrow: "Control",
  headline: "You decide how far each agent goes.",
  lead: "Every kind of action has its own setting. Start an agent on Suggest, watch its record, and loosen it when you trust it.",
  dial: {
    title: "Set one action",
    actionLabel: "Action",
    levelLabel: "Level",
    actions: [
      { id: "offer", agent: "atlas", label: "Send job offers to cleaners" },
      { id: "delay", agent: "atlas", label: "Tell a customer a visit is running late" },
      { id: "credit", agent: "loop", label: "Give a credit for a missed standard" },
      { id: "followup", agent: "vera", label: "Follow up on a quiet quote" },
    ],
    levels: [
      { id: "off", label: "Off", body: "The agent does not do this." },
      { id: "suggest", label: "Suggest", body: "The agent prepares the action and its reason. You approve, edit or skip." },
      { id: "tell", label: "Act, then tell", body: "The agent acts at once and reports it. You can undo where undo is possible." },
      { id: "act", label: "Act", body: "The agent acts. It appears in the activity record." },
    ],
    trust: "Before you loosen a setting you see the record, for example: staffed 41 jobs this week, you changed 2.",
  },
  always: {
    title: "Always a person",
    note: "These never run on their own, at any setting.",
    items: [
      "Paying out a pay run",
      "Refunds and credits above your limit",
      "Rejecting or ending a worker",
      "Any decision after a background check",
      "Changing prices, pay rates or policies",
      "Damage, injuries, disputes and legal questions",
    ],
  },
  rules: [
    { title: "Rules produce the numbers", body: "Prices, pay, fees and scores come from your settings. The AI explains a number. It never makes one up." },
    { title: "It steps back down", body: "If you keep undoing one kind of action, that action returns to Suggest on its own and you are told." },
    { title: "One switch stops everything", body: "Pause every agent for your company at once." },
    { title: "Everything is written down", body: "What started each action, what was read, what was decided and why." },
  ],
} as const;

/** The example run in the Control section: Atlas staffing one job. All names and figures are made up. */
export const RUN = {
  agent: "Atlas",
  skill: "Staffing: Thursday 9:00, deep clean, 3 bedrooms",
  company: "Example company",
  stateLabel: { queued: "Queued", running: "Working", done: "Done", blocked: "Stopped", waiting: "Needs you" },
  steps: [
    { id: "read", tool: "Read the job", target: "Size, service, time window, crew of 2", state: "done", guard: "rules", result: "Needs 2 cleaners for about 4 hours." },
    { id: "list", tool: "List who can do it", target: "Active, cleared, available, in range", state: "done", guard: "rules", result: "7 can. 3 cannot: one is over their weekly limit, two would not have time to get there." },
    { id: "rank", tool: "Rank them", target: "Distance, quality, workload, reliability", state: "done", guard: "record", result: "Maria R. is first: she is this customer's usual cleaner." },
    { id: "offer", tool: "Send offers", target: "Maria R. and Dana K.", state: "done", guard: "setting", result: "Each offer shows that cleaner's own pay. Maria accepted. Dana declined." },
    { id: "gap", tool: "Offer to the next cleaner", target: "Priya S.", state: "blocked", guard: "rules", result: "Priya finishes another job 40 minutes before. Your rule is 60 minutes plus travel. Atlas will not break it." },
    { id: "ask", tool: "Ask a person", target: "Allow the shorter gap, or offer to the next cleaner", state: "waiting", guard: "person", result: "Waiting for a decision. The next cleaner is 9 miles further away." },
  ],
  decision: { title: "Allow a 40-minute gap for Priya S. on Thursday?", meta: "Atlas · Staffing · needs an owner or manager" },
  guardsTitle: "What held",
  guardOn: "Held",
  guardWaiting: "Not reached",
  guards: [
    { id: "rules", title: "Your rules decide", body: "Who can take a job comes from your settings, not from a guess." },
    { id: "setting", title: "Your autonomy setting", body: "Offers went out because you set that action to Act." },
    { id: "person", title: "A person for the exception", body: "Breaking a rule is never the agent's call." },
    { id: "record", title: "Written to the record", body: "Each step is saved with its reason." },
  ],
  recordTitle: "Activity record",
  record: [
    { afterStep: 1, time: "08:02", text: "Job read. Crew of 2 needed." },
    { afterStep: 2, time: "08:02", text: "7 eligible, 3 ruled out with reasons." },
    { afterStep: 4, time: "08:03", text: "Offers sent. Maria R. accepted." },
    { afterStep: 5, time: "08:14", text: "Stopped: time-between-jobs rule." },
    { afterStep: 6, time: "08:14", text: "Decision sent to the queue." },
  ],
  recordApproved: { time: "08:21", text: "Approved by you. Offer sent to Priya S." },
  approval: {
    hold: "Hold to approve",
    holding: "Keep holding",
    hint: "Hold the button for a moment. This is an example and changes nothing.",
    approvedTitle: "Approved",
    approvedBody: "Atlas sends the offer and records who allowed it.",
    reset: "Reset",
    waiting: "Waiting",
    approved: "Approved",
  },
} as const;

export const SCORECARD = {
  title: "A scorecard that checks the agents",
  body: "What each agent says it did sits beside what the record confirms. If a source cannot be reached, the number reads as unverified. It never reads as zero.",
  columns: { agent: "Agent", claim: "Reported", check: "Confirmed by", result: "Confirmed" },
  rows: [
    { agent: "vera", claim: "12 bookings", check: "Deposits received", result: "12", state: "match" },
    { agent: "atlas", claim: "41 jobs staffed", check: "Cleaner check-ins", result: "39", state: "gap" },
    { agent: "loop", claim: "6 customers kept", check: "Plans still active", result: "6", state: "match" },
    { agent: "scout", claim: "3 cleaners activated", check: "First jobs completed", result: "Unverified", state: "unverified" },
  ],
  note: "Example figures.",
} as const;

export const QUEUE = {
  window: "Decisions",
  briefingTitle: "This morning",
  briefing: "Overnight: 4 leads answered, 2 booked. All of today's 14 jobs are staffed. 3 things need you.",
  crewTitle: "Agents",
  crew: [
    { agent: "vera", statuses: ["Replying to a lead", "Quoting a 3-bedroom", "Following up a quote"] },
    { agent: "atlas", statuses: ["Watching check-ins", "Finding cover", "Confirming tomorrow"] },
    { agent: "scout", statuses: ["Scoring an interview", "Chasing a tax form", "Idle"] },
    { agent: "loop", statuses: ["Asking for feedback", "Recovering a payment", "Offering a plan"] },
  ],
  items: [
    {
      agent: "atlas",
      title: "Allow a shorter gap for Priya S. on Thursday?",
      reason: "Dana declined. Priya is next but finishes another job 40 minutes before. Your rule is 60.",
      state: "Needs you",
    },
    {
      agent: "loop",
      title: "Refund $45 to the Hendersons",
      reason: "Rated 2 of 5. Photos show the oven was missed. Above your $25 limit for credits.",
      state: "Needs you",
    },
    {
      agent: "scout",
      title: "Move 2 applicants forward",
      reason: "Both passed your requirements and scored 4 or higher on every interview question.",
      state: "Needs you",
    },
  ],
  actions: { approve: "Approve", edit: "Edit", skip: "Skip" },
} as const;

export const WHO = {
  id: "who",
  eyebrow: "Who it is for",
  headline: "Built for how cleaning companies actually work.",
  lead: "From an owner with three cleaners to a multi-crew operation with office staff.",
  kinds: [
    { id: "home", title: "Homes", body: "One-time and recurring cleaning, with plans, skips and pauses the customer manages from a link." },
    { id: "rental", title: "Short-term rentals", body: "Turnovers for hosts, quoted in a minute and scheduled around checkout." },
    { id: "pm", title: "Property managers", body: "Many units, volume pricing and one invoice per period." },
    { id: "office", title: "Offices and commercial", body: "Walkthroughs, proposals, agreements and insurance certificates." },
  ],
  workers: {
    title: "Contractors or employees",
    body: "Pay cleaners a share of each job or by the hour. Onboarding, pay and wording follow the model you run.",
  },
  rules: {
    title: "Your rules, not ours",
    body: "Pricing, pay, service areas, checklists, fees and guarantees are settings you fill in. The agents work inside them.",
  },
} as const;

export const PRICING = {
  id: "pricing",
  headline: "Pricing",
  name: "Early access",
  price: "Set with our first companies",
  body: "A monthly plan that includes agent work and texting, with top-ups beyond that. You see what each agent used. We are setting the numbers with the companies in early access.",
  cta: "Book a call",
} as const;

export const FAQ = {
  id: "faq",
  headline: "Questions",
  items: [
    {
      q: "Is Renuvo available now?",
      a: "Not yet. Renuvo is in development. We are talking with cleaning companies now and will open early access to a small group first. Book a call or join the waitlist and we will be in touch.",
    },
    {
      q: "Do the agents act without asking me?",
      a: "Only where you allow it. Every kind of action has its own setting: Off, Suggest, Act then tell, or Act. Some actions always need a person, such as paying out a pay run, a refund above your limit, or ending a worker.",
    },
    {
      q: "Do customers know they are talking to an AI?",
      a: "Yes. Each agent introduces itself as an AI assistant for your company and gives a straight answer if asked. There are no human personas.",
    },
    {
      q: "Where do prices and pay come from?",
      a: "From your settings. You fill in your pricing, pay, fees and service areas. The agents apply them. The AI can explain a number but never produces one.",
    },
    {
      q: "Do I have to leave the software I use now?",
      a: "Renuvo is built to be where your customers, jobs and cleaners live, because agents cannot run dispatch on someone else's calendar. Import tools to bring your data across are part of the plan.",
    },
    {
      q: "Does it work for contractors and for employees?",
      a: "Both are planned for launch: cleaners paid a share of each job, and cleaners paid by the hour.",
    },
    {
      q: "Will the agents answer phone calls?",
      a: "Text, email and web chat come first. Voice follows.",
    },
    {
      q: "What does it cost?",
      a: "A monthly plan that includes agent work and texting, with top-ups beyond that. We are setting the numbers with our first companies.",
    },
  ],
} as const;

export const FINAL_CTA = {
  id: "waitlist",
  headline: "See where it is going. Tell us what you need.",
  body: "We are building Renuvo with cleaning company owners. Book a call to walk through it, or join the waitlist for early access.",
  primary: "Book a call",
} as const;

export const WAITLIST = {
  title: "Join the waitlist",
  fields: {
    name: "Your name",
    company: "Company",
    email: "Email",
    size: "How many cleaners work with you?",
  },
  sizes: ["Just me", "2 to 5", "6 to 15", "16 to 40", "More than 40"],
  submit: "Join the waitlist",
  sending: "Sending",
  consent: "We will email you about Renuvo early access. Nothing else.",
  done: { title: "You are on the list.", body: "We will email you when early access opens." },
  errors: {
    invalid: "Check your name, company and email, then try again.",
    closed: "The waitlist is not open yet. Please book a call instead.",
    failed: "That did not go through. Please try again in a moment.",
  },
} as const;

export const FOOTER = {
  note: "Renuvo is in development. Product screens on this page are examples of the design, with made-up names and figures.",
  rights: "Renuvo",
} as const;
