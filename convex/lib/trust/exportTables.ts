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
  { table: "sourceMessages", index: "by_company_received" },
  { table: "formSessions", index: "by_company_application" },
  { table: "applicantAttachments", index: "by_company_application", omit: ["storageId", "clientKey"], why: "Internal file references. The files themselves are not in the file." },
  { table: "screenings", index: "by_company_application" },
  { table: "hiringDecisions", index: "by_company_application" },
  { table: "interviewSlots", index: "by_company_start" },
  { table: "interviews", index: "by_company_application" },
  { table: "hiringOffers", index: "by_company_application" },
  { table: "onboardingHandoffs", index: "by_company_status" },
  // Company Chat (convex/lib/chat/schema.ts). The conversations themselves are not here: see NOT_EXPORTED.
  { table: "chatRuns", index: "by_company_started", omit: ["error"], why: "Run errors are words for the person who was chatting." },
  { table: "chatActionSteps", index: "by_company_key" },
  { table: "chatArtifacts", index: "by_company_creator_updated" },
  { table: "chatArtifactVersions", index: "by_company_artifact_version" },
  { table: "companyKnowledge", index: "by_company_status" },
  { table: "chatUsage", index: "by_company_month" },
  // The AI layer (convex/lib/ai/schema.ts).
  { table: "aiUsage", index: "by_company_at", omit: ["raw"], why: "The provider's raw usage object is kept for reconciliation only." },
  { table: "mediaAssets", index: "by_company_created", omit: ["storageId"], why: "Internal file references. The files themselves are not in the file." },
  { table: "mediaJobs", index: "by_company_created" },
  { table: "mediaAllowances", index: "by_company_month" },
];

/** Company tables kept out of the export, and why. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  actionLinks: "Each row is half of a cleaner's link; a copy of it must never leave the record.",
  applicantLinks: "Each row is half of an applicant's link; a copy of it must never leave the record.",
  sendIntents: "Internal bookkeeping for the sending check: the same facts are in each message and in the event log.",
  conversations: "Chats are private to the member who wrote them until sharing exists; what a chat did to the business is exported as chatActionSteps, and its drafts as chatArtifacts.",
  knowledgeChunks: "A search index rebuilt from company knowledge and drafts, which are exported themselves.",
  chatUploads: "Internal file references for chat attachments; the files themselves are private to the member who uploaded them.",
  chatMessages: "The words of private chats, for the same reason as conversations.",
  trustRequests: "Requests to Selestial are Selestial's records about a person, answered through the privacy request process.",
};

/** Fields of the company row itself that never leave. */
export const COMPANY_OMIT = ["setupKey"] as const;

/** Removes the named fields from a row. */
export function without(row: Record<string, unknown>, omit: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) if (!omit.includes(name)) out[name] = value;
  return out;
}
