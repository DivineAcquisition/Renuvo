/**
 * What the chat screens share: the words for each state, where the open chat is remembered, and how a
 * tool is described while it works. Pure functions; no React, no storage access of their own.
 */

export type ConversationState = "idle" | "working" | "needs_input" | "awaiting_approval" | "completed" | "failed" | "stopped";
export type StepStatus = "running" | "done" | "proposed" | "refused" | "unavailable" | "awaiting_approval" | "rejected" | "expired" | "failed" | "cancelled";

/** The status shown beside a chat. Status never depends on color alone: every one has words. */
export const STATE_LOOK: Record<ConversationState, { label: string; tone: "brand" | "warning" | "success" | "destructive" | "muted" }> = {
  idle: { label: "New", tone: "muted" },
  working: { label: "Working", tone: "brand" },
  needs_input: { label: "Needs your input", tone: "warning" },
  awaiting_approval: { label: "Awaiting approval", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  stopped: { label: "Stopped", tone: "muted" },
};

export const STEP_WORDS: Record<StepStatus, string> = {
  running: "Working",
  done: "Done",
  proposed: "Waiting for approval in Approvals",
  refused: "Not done",
  unavailable: "Not available yet",
  awaiting_approval: "Needs your approval",
  rejected: "Declined",
  expired: "Approval no longer applies",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** What a tool is doing, in words, while it runs and once it is done. */
export const TOOL_WORDS: Record<string, { working: string; done: string }> = {
  calculate: { working: "Calculating", done: "Calculated" },
  price_service: { working: "Working out the price", done: "Priced" },
  company_profile: { working: "Reading the company profile", done: "Read the company profile" },
  attention_summary: { working: "Checking what needs attention", done: "Checked what needs attention" },
  list_jobs: { working: "Reading the schedule", done: "Read the schedule" },
  find_records: { working: "Looking up records", done: "Looked up records" },
  get_record: { working: "Reading a record", done: "Read a record" },
  list_tasks: { working: "Reading tasks", done: "Read tasks" },
  inspect_visit_staffing: { working: "Dispatch is checking the visit", done: "Dispatch checked the visit" },
  request_dispatch_offer: { working: "Dispatch is preparing an offer", done: "Dispatch offer" },
  inspect_application: { working: "Recruiter is reading the application", done: "Recruiter read the application" },
  request_application_invitation: { working: "Recruiter is routing the invitation", done: "Invitation" },
  prepare_hiring_offer: { working: "Recruiter is drafting the offer", done: "Hiring offer drafted" },
  create_hiring_need: { working: "Preparing a hiring need", done: "Hiring need" },
  create_task: { working: "Creating a task", done: "Task" },
  save_draft: { working: "Writing the draft", done: "Draft saved" },
  read_draft: { working: "Reading the draft", done: "Read the draft" },
  revise_draft: { working: "Revising the draft", done: "Draft revised" },
  record_draft_status: { working: "Recording the document's status", done: "Document status" },
  propose_company_knowledge: { working: "Proposing company knowledge", done: "Company knowledge proposed" },
  send_customer_message: { working: "Checking customer messaging", done: "Customer message" },
  update_price_book: { working: "Checking the price book", done: "Live price change" },
  launch_campaign: { working: "Checking campaign sending", done: "Campaign launch" },
  send_for_signature: { working: "Checking e-signature", done: "E-signature" },
  issue_refund_or_credit: { working: "Checking refunds", done: "Refund or credit" },
};

export const SPECIALIST_NAMES: Record<string, string> = {
  dispatch: "Dispatch",
  recruiter: "Recruiter",
  sales: "Sales",
  retention: "Retention",
  marketing: "Marketing",
  quality: "Quality",
  "customer-care": "Customer Care",
  "team-coordinator": "Team Coordinator",
};

export function toolWords(tool: string, status: StepStatus): string {
  const words = TOOL_WORDS[tool] ?? { working: "Working", done: tool.replace(/_/g, " ") };
  return status === "running" ? words.working : words.done;
}

/** The chat that is open, remembered per person and per company, so switching company never shows another company's chat. */
export function chatStorageKey(userId: string, companyId: string): string {
  return `selestial.chat:${userId}:${companyId}`;
}

export type StoredChat = { conversationId: string | null; panelOpen: boolean };

export function parseStoredChat(raw: string | null | undefined): StoredChat {
  try {
    const value = JSON.parse(raw ?? "") as { conversationId?: unknown; panelOpen?: unknown };
    return { conversationId: typeof value.conversationId === "string" && /^[a-z0-9]{10,64}$/.test(value.conversationId) ? value.conversationId : null, panelOpen: value.panelOpen === true };
  } catch {
    return { conversationId: null, panelOpen: false };
  }
}

/** "just now", "5m", "3h", "Tue", "Mar 2". */
export function shortWhen(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(at));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(at));
}

export const STARTERS: readonly string[] = [
  "Help me price a recurring cleaning service.",
  "Draft a customer service agreement.",
  "What needs my attention this week?",
  "Review tomorrow's staffing gaps.",
  "Build a cleaner onboarding checklist.",
  "Help me respond to this customer.",
];

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function newClientKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Convex's words when a function is not on the deployment the app is talking to. */
const NOT_DEPLOYED = /Could not find public function/i;

/** What a person is told when chat cannot load. A backend without chat's functions is said plainly. */
export function chatFailureWords(error: unknown): { title: string; body: string; short: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (NOT_DEPLOYED.test(message)) {
    return {
      title: "Chat is not switched on for this workspace yet",
      body: "The chat screens are here, but the server side of Company Chat has not been deployed to this workspace's backend yet. Nothing is wrong with your account, and the rest of Selestial works as usual.",
      short: "Its server side is not deployed yet. The rest of Selestial works as usual.",
    };
  }
  return { title: "Chat could not load", body: "Something went wrong while loading chat. The rest of Selestial still works. Try again in a moment.", short: "Something went wrong. Try again in a moment." };
}
