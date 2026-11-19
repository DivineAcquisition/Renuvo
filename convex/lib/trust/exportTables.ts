/**
 * What a company's data export holds, table by table. Every table with a `companyId` must be listed
 * either in EXPORT_TABLES (with the index that starts with companyId and the fields left out) or in
 * NOT_EXPORTED (with the reason). convex/dataRights.test.ts fails when a table is in neither, so a new
 * company table is never left out, or put in, by accident.
 *
 * Tables that other work may add later can be listed already: one that is not in the schema yet is
 * skipped when the export is built.
 */
export type ExportTable = {
  table: string;
  /** An index whose first field is companyId. */
  index: string;
  /** Fields never written to the file. */
  omit?: readonly string[];
  /** Why the omitted fields are left out. */
  why?: string;
};

export const EXPORT_TABLES: readonly ExportTable[] = [
  { table: "members", index: "by_company" },
  { table: "invitations", index: "by_company", omit: ["publicId"], why: "Half of an invitation link." },
  { table: "customers", index: "by_company_status" },
  { table: "properties", index: "by_company_customer" },
  { table: "cleaners", index: "by_company_status" },
  { table: "availabilityWindows", index: "by_company_cleaner" },
  { table: "timeOff", index: "by_company_cleaner_end" },
  { table: "jobs", index: "by_company_start" },
  { table: "assignments", index: "by_company_job" },
  { table: "tasks", index: "by_company_status_due" },
  { table: "permissions", index: "by_company_action" },
  { table: "approvals", index: "by_company_status_decideBy" },
  { table: "messages", index: "by_company_queued" },
  { table: "coverageRequests", index: "by_company_job" },
  { table: "checklistItems", index: "by_company_job" },
  { table: "checklistTemplates", index: "by_company_service_version" },
  { table: "textingRequests", index: "by_company_requested" },
  { table: "replyReadings", index: "by_company_received" },
  { table: "evidence", index: "by_company_job", omit: ["storageId", "clientKey"], why: "Internal file references. The photos themselves are not in the file." },
  { table: "jobReports", index: "by_company_job" },
  { table: "toolRuns", index: "by_company_key" },
  { table: "events", index: "by_company_at" },
  { table: "dataExports", index: "by_company_created", omit: ["storageId"], why: "Internal file references." },
  { table: "deletionRecords", index: "by_company_at" },
  // Messaging consent, the compliance profile and agreements (convex/lib/compliance/schema.ts).
  { table: "complianceProfiles", index: "by_company" },
  { table: "consentDisclosures", index: "by_company_created" },
  { table: "contactPermissions", index: "by_company_recipient" },
  { table: "permissionHistory", index: "by_company_recipient_at" },
  { table: "suppressions", index: "by_company_at" },
  { table: "agreementAcceptances", index: "by_company_at" },
  // Recruiter (convex/lib/recruiter/schema.ts).
  { table: "hiringNeeds", index: "by_company_status" },
  { table: "applicants", index: "by_company_email" },
  { table: "applications", index: "by_company_stage" },
  { table: "mailboxConnections", index: "by_company", omit: ["cursor"], why: "The mail provider's internal read position." },
  // Plans and credits (convex/lib/billing/schema.ts).
  { table: "billingAccounts", index: "by_company_env" },
  { table: "aiExecutions", index: "by_company_created", omit: ["lockId"], why: "Autumn's internal reference for a credit hold." },
  { table: "messagingCharges", index: "by_company_created", omit: ["lockId"], why: "Autumn's internal reference for a messaging hold." },
  { table: "billingIntents", index: "by_company_created", omit: ["url"], why: "A short-lived payment or portal address." },
  { table: "agentAccessRequests", index: "by_company_last" },
  { table: "messagingAttention", index: "by_company_at", omit: ["resolvedBy"], why: "Which Selestial staff member resolved it." },
  { table: "messagingTopUps", index: "by_company_created", omit: ["intentId", "applied"], why: "Internal references to a purchase request and to payment events already applied." },
  { table: "sourceMessages", index: "by_company_received" },
  { table: "formSessions", index: "by_company_application" },
  { table: "applicantAttachments", index: "by_company_application", omit: ["storageId", "clientKey"], why: "Internal file references. The files themselves are not in the file." },
  { table: "screenings", index: "by_company_application" },
  { table: "hiringDecisions", index: "by_company_application" },
  { table: "interviewSlots", index: "by_company_start" },
  { table: "interviews", index: "by_company_application" },
  { table: "hiringOffers", index: "by_company_application" },
  { table: "onboardingHandoffs", index: "by_company_status" },
  { table: "integrationRequests", index: "by_company_integration" },
  // Company setup and the shared company context (convex/lib/setup/schema.ts).
  { table: "companySetups", index: "by_company" },
  { table: "companyFacts", index: "by_company_key" },
  { table: "websiteReads", index: "by_company_started" },
  { table: "clientImportRuns", index: "by_company_key" },
  { table: "importedRecords", index: "by_company_source_external" },
  // Activation: the first agent work an Owner started, and the in-app notices (convex/lib/activation/schema.ts).
  { table: "activations", index: "by_company_started" },
  { table: "activationTasks", index: "by_company_state" },
  { table: "memberNotices", index: "by_company_dedupe" },
  // Company Chat (convex/lib/chat/schema.ts). The conversations themselves are not here: see NOT_EXPORTED.
  { table: "chatRuns", index: "by_company_started", omit: ["error"], why: "Run errors are words for the person who was chatting." },
  { table: "chatActionSteps", index: "by_company_key" },
  { table: "chatArtifacts", index: "by_company_creator_updated" },
  { table: "chatArtifactVersions", index: "by_company_artifact_version" },
  { table: "companyKnowledge", index: "by_company_status" },
  { table: "chatUsage", index: "by_company_month" },
  // Company agreements (convex/lib/agreements/schema.ts). The export is the Owner's, so restricted documents are included.
  { table: "agreements", index: "by_company_updated" },
  { table: "agreementVersions", index: "by_company_agreement_version" },
  { table: "agreementLinks", index: "by_company_agreement" },
  { table: "agreementComments", index: "by_company_agreement" },
  { table: "agreementTemplates", index: "by_company_status" },
  { table: "agreementTemplateVersions", index: "by_company_template_version" },
  { table: "agreementFiles", index: "by_company_created", omit: ["storageId"], why: "Internal file references. The original files themselves are not in the file." },
  { table: "agreementSignatureRequests", index: "by_company_agreement", omit: ["signedFileId", "providerRequestId"], why: "Internal file and provider references." },
  // The AI layer (convex/lib/ai/schema.ts).
  { table: "aiUsage", index: "by_company_at", omit: ["raw"], why: "The provider's raw usage object is kept for reconciliation only." },
  { table: "mediaAssets", index: "by_company_created", omit: ["storageId"], why: "Internal file references. The files themselves are not in the file." },
  { table: "mediaJobs", index: "by_company_created" },
  { table: "mediaAllowances", index: "by_company_month" },
  // Google (convex/lib/google/schema.ts). What was connected, chosen, received and sent; never a credential.
  { table: "googleConnections", index: "by_company" },
  { table: "connectorConnections", index: "by_company_system" },
  { table: "setupWork", index: "by_company_agent" },
  { table: "googleResources", index: "by_company_kind" },
  { table: "googleJobs", index: "by_company_status", omit: ["payload"], why: "Internal work instructions; what each job did is in its result and in the event log." },
  { table: "googleCalendarLinks", index: "by_company_subject" },
  { table: "googleReviews", index: "by_company_created" },
  { table: "googleLeads", index: "by_company_received" },
  { table: "googleConversions", index: "by_company_created" },
  { table: "googleAdDrafts", index: "by_company_updated" },
  { table: "googleAdsSnapshots", index: "by_company_account" },
  { table: "googleDriveTexts", index: "by_company_resource" },
  { table: "googleSettings", index: "by_company" },
  // Services & Pricing (convex/lib/services/schema.ts): the catalog, every version, drafts, reviews, property prices, costs, quotes, imports and research.
  { table: "services", index: "by_company_status" },
  { table: "serviceVersions", index: "by_company_service_version" },
  { table: "serviceDrafts", index: "by_company_service" },
  { table: "serviceChanges", index: "by_company_updated", omit: ["scheduledFunctionId"], why: "An internal reference to the scheduler." },
  { table: "propertyPrices", index: "by_company_state" },
  // Clients & Properties (convex/lib/clients/schema.ts): contacts, plans, internal notes and texts clients sent.
  { table: "clientContacts", index: "by_company_customer" },
  { table: "servicePlans", index: "by_company_customer" },
  { table: "clientNotes", index: "by_company_customer" },
  { table: "inboundMessages", index: "by_company_customer" },
  // Retention (convex/lib/retention/schema.ts): signals, cases and their history, actions, feedback, and background runs.
  { table: "retentionSignals", index: "by_company_status" },
  { table: "retentionCases", index: "by_company_status" },
  { table: "retentionEntries", index: "by_company_case" },
  { table: "retentionActions", index: "by_company_case" },
  { table: "retentionFeedback", index: "by_company_customer" },
  { table: "retentionLinks", index: "by_company_customer", omit: ["publicId"], why: "Half of a customer link." },
  { table: "retentionRuns", index: "by_company_kind", omit: ["payload"], why: "A customer's text held only until it is read; the conversation keeps it." },
  { table: "pricingProfiles", index: "by_company" },
  { table: "serviceQuotes", index: "by_company_created" },
  { table: "serviceImports", index: "by_company_created" },
  { table: "researchBriefs", index: "by_company_created" },
  { table: "researchSources", index: "by_company_brief" },
  // Finance: the company's own money (convex/lib/finance/schema.ts).
  { table: "financeSettings", index: "by_company" },
  { table: "stripeAccounts", index: "by_company", omit: ["onboarding"], why: "A single-use Stripe onboarding link." },
  { table: "agreementSigningLinks", index: "by_company_request", omit: ["publicId"], why: "Half of a signing link." },
  // Sales (convex/lib/sales/schema.ts).
  { table: "salesOpportunities", index: "by_company_updated" },
  { table: "salesDrafts", index: "by_company_updated" },
  { table: "salesQuotes", index: "by_company_created", omit: ["publicId"], why: "Half of a quote link." },
  { table: "bookings", index: "by_company_created" },
  { table: "recurringPlans", index: "by_company_status" },
  { table: "planVisits", index: "by_company_state" },
  { table: "proposals", index: "by_company_updated", omit: ["publicId"], why: "Half of a proposal link." },
  { table: "assessments", index: "by_company_status", omit: ["publicId"], why: "Half of an assessment link." },
  { table: "serviceSetups", index: "by_company_status" },
  // The Sales agent (convex/lib/sales/agentSchema.ts).
  { table: "salesMessages", index: "by_company_opportunity" },
  { table: "salesActions", index: "by_company_created" },
  { table: "salesRuns", index: "by_company_status" },
  { table: "salesFollowUps", index: "by_company_status_due" },
  { table: "salesBatches", index: "by_company_status" },
  { table: "recurringPlanVersions", index: "by_company_created" },
  { table: "proposalVersions", index: "by_company_created" },
  { table: "proposalResponses", index: "by_company_at" },
  { table: "invoices", index: "by_company_created", omit: ["publicId"], why: "Half of a pay link." },
  { table: "payments", index: "by_company_invoice", omit: ["stripe.clientSecret"], why: "Lets a browser finish an unfinished card payment." },
  { table: "refunds", index: "by_company_invoice" },
  { table: "invoiceCredits", index: "by_company_invoice" },
  { table: "financeMessages", index: "by_company_invoice" },
  { table: "earnings", index: "by_company_job" },
  { table: "teamPayments", index: "by_company_cleaner" },
  { table: "tips", index: "by_company_job" },
  { table: "statementLinks", index: "by_company_cleaner", omit: ["publicId"], why: "Half of a cleaner's statement link." },
  { table: "expenses", index: "by_company_spent" },
  { table: "expenseReceipts", index: "by_company_sha", omit: ["storageId"], why: "An internal file reference; the receipt files themselves are not in the export. What was read from each is." },
  { table: "expenseRules", index: "by_company" },
  { table: "expenseImports", index: "by_company_created" },
  // Cleaners (convex/lib/cleaners/schema.ts). The export is the Owner's, so pay and personnel records are included.
  { table: "subcontractors", index: "by_company_status" },
  { table: "workerAffiliations", index: "by_company_cleaner" },
  { table: "requirementDefinitions", index: "by_company_key" },
  { table: "workerRequirements", index: "by_company_cleaner", omit: ["evidence"], why: "Internal file references for uploaded documents; the files themselves are not in the file. Each requirement's state, review and dates are." },
  { table: "availabilityExceptions", index: "by_company_cleaner_date" },
  { table: "skillClaims", index: "by_company_cleaner" },
  { table: "crews", index: "by_company_status" },
  { table: "crewMemberships", index: "by_company_crew" },
  { table: "portalLinks", index: "by_company_issued", omit: ["publicId"], why: "Half of a portal link." },
  { table: "followUps", index: "by_company_cleaner" },
  { table: "coachingNotes", index: "by_company_cleaner" },
  { table: "recordDisputes", index: "by_company_cleaner" },
  { table: "personnelRequests", index: "by_company_status" },
  { table: "payArrangements", index: "by_company_cleaner" },
  // Booking Experiences (convex/lib/booking/schema.ts).
  { table: "bookingSettings", index: "by_company" },
  { table: "bookingExperiences", index: "by_company_updated" },
  { table: "bookingExperienceVersions", index: "by_company_experience_version" },
  { table: "bookingSessions", index: "by_company_created", omit: ["tokenHash"], why: "A hash of a customer's private booking link." },
  { table: "bookingHolds", index: "by_company_start" },
  { table: "bookingImages", index: "by_company" },
  { table: "bookingAcceptances", index: "by_company_session", omit: ["ipHash"], why: "A one-way hash kept only as signing evidence." },
  { table: "bookingEvents", index: "by_company_experience_at" },
  // Notifications to members (convex/lib/notify/schema.ts): each person's choices. The notices themselves are messages.
  { table: "notificationPreferences", index: "by_company_member" },
];

/** Company tables kept out of the export, and why. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  clientViews: "The client directory's search rows, rebuilt from clients, contacts and properties, which are exported.",
  numberSearches: "Lists of numbers that were for sale at the moment of a search; the number the company asked for is in its texting request.",
  actionLinks: "Each row is half of a cleaner's link; a copy of it must never leave the record.",
  applicantLinks: "Each row is half of an applicant's link; a copy of it must never leave the record.",
  billingWebhooks: "Delivery references for Autumn's notices to Selestial; the plan and balances they point to are exported as billingAccounts.",
  mailboxCredentials: "A sealed authorization to read and send from the company's mailbox; it opens the mailbox, so a copy must never leave. The connection itself is exported.",
  oauthStates: "Ten-minute, single-use records of a mailbox sign-in in progress; nothing in them is about the business.",
  sendIntents: "Internal bookkeeping for the sending check: the same facts are in each message and in the event log.",
  conversations: "Chats are private to the member who wrote them until sharing exists; what a chat did to the business is exported as chatActionSteps, and its drafts as chatArtifacts.",
  knowledgeChunks: "A search index rebuilt from company knowledge and drafts, which are exported themselves.",
  chatUploads: "Internal file references for chat attachments; the files themselves are private to the member who uploaded them.",
  chatMessages: "The words of private chats, for the same reason as conversations.",
  googleCredentials: "A sealed authorization to the company's Google account; it opens the account, so a copy must never leave. The connection itself is exported.",
  googleOAuthStates: "Ten-minute, single-use records of a Google sign-in in progress; nothing in them is about the business.",
  googleLeadKeys: "The hash of the lead-form key; it proves Google's deliveries and is useless outside Selestial.",
  googleWatches: "Notification channels with Google, renewed automatically; their secrets must not leave.",
  googleChoices: "A short-lived copy of what Google listed for the Owner to choose from.",
  googleBusy: "A short-lived copy of busy times read from Google Calendar; the calendar itself is the record.",
  connectorCredentials: "A sealed authorization to the company's Jobber or Housecall Pro account; it opens that account, so a copy must never leave. The connection itself is exported.",
  connectorStates: "Ten-minute, single-use records of a Jobber sign-in in progress; nothing in them is about the business.",
  connectorReads: "A copy of another system's client list kept for a day while the owner checks it; what was imported is exported as clients and properties.",
  googleTravel: "Cached drive times between rounded map points, recomputed as needed.",
  portalCodes: "Hashes of one-time codes that unlock a portal for ten minutes; nothing in them is about the business.",
  capacityHolds: "Short-lived reservations of a day's minutes while a booking waits; the booking keeps what matters.",
  trustRequests: "Requests to Selestial are Selestial's records about a person, answered through the privacy request process.",
};

/** Fields of the company row itself that never leave. */
export const COMPANY_OMIT = ["setupKey"] as const;

/** Removes the named fields from a row. */
export function without(row: Record<string, unknown>, omit: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (omit.includes(name)) continue;
    // "stripe.clientSecret" leaves out one field inside an object and keeps the rest of it.
    const inner = omit.filter((path) => path.startsWith(`${name}.`)).map((path) => path.slice(name.length + 1));
    out[name] = inner.length && value && typeof value === "object" && !Array.isArray(value) ? without(value as Record<string, unknown>, inner) : value;
  }
  return out;
}
