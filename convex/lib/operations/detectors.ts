/**
 * The checks that find incidents (docs/operations/02-incidents.md). Each one reads a bounded number of
 * rows through an index, never calls a model or a provider, and tells normal waiting apart from failure:
 * a registration with the carriers or a run waiting for approval is not broken.
 *
 * A check has two halves. `scan` lists the records worth looking at; `evaluate` looks at one record and
 * says whether the condition is there. The same `evaluate` is what closes an incident: an incident
 * closes only when every record it names is evaluated again and none still shows the condition.
 */
import type { Doc, Id, TableNames } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { maskAddress } from "../cleaners/portal";
import type { Area, Check, Kind, OpenState, Severity } from "./catalog";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type Related = { table: string; id: string };

export type Finding = {
  /** The incident this belongs to. Several records can share one key (for example one per company). */
  key: string;
  kind: Kind;
  area: Area;
  companyId?: Id<"companies">;
  provider?: string;
  severity: Severity;
  state: OpenState;
  title: string;
  impact: string;
  nextAction: string;
  diagnostics?: string;
  /** The record that shows it. */
  source: Related;
  /** When the condition began on this record, as well as the record can tell. */
  since: number;
  /** Automatic recovery attempts the record shows. */
  attempts: number;
  /** For a key several records share: the title and impact for n of them. */
  plural?: (n: number) => { title: string; impact: string };
};

export type Detector = {
  check: Check;
  /** How often it runs. Shown as stale when it has not finished for three of these. */
  everyMinutes: number;
  scan: (ctx: QueryCtx, now: number) => Promise<Related[]>;
  evaluate: (ctx: QueryCtx, source: Related, now: number) => Promise<Finding | null>;
};

const ref = (table: string, id: string): Related => ({ table, id });
const many = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
const ago = (ms: number) => (ms >= DAY ? many(Math.floor(ms / DAY), "day", "days") : ms >= HOUR ? many(Math.floor(ms / HOUR), "hour", "hours") : many(Math.max(1, Math.floor(ms / MINUTE)), "minute", "minutes"));

async function load<T extends TableNames>(ctx: QueryCtx, table: T, source: Related): Promise<Doc<T> | null> {
  if (source.table !== table) return null;
  const id = ctx.db.normalizeId(table, source.id);
  return id ? await ctx.db.get(id) : null;
}

const AGENT_NAMES: Record<string, string> = { dispatch: "Dispatch", recruiter: "Recruiter", sales: "Sales", retention: "Care & Retention" };
const agentName = (agent: string) => AGENT_NAMES[agent] ?? agent;

// ── Agent work ────────────────────────────────────────────────────────────────────────────────────

/** The activation sweep (every 5 minutes) retries a step 30 seconds after its lease runs out. Twenty minutes means it is not running. */
const LEASE_STUCK = 20 * MINUTE;
const FAILED_WINDOW = 7 * DAY;

const agentWork: Detector = {
  check: "agent_work",
  everyMinutes: 5,
  async scan(ctx, now) {
    const stuck = await ctx.db
      .query("activationTasks")
      .withIndex("by_state_lease", (q) => q.eq("state", "working").lt("leaseUntil", now - LEASE_STUCK))
      .take(100);
    const failed = await ctx.db
      .query("activationTasks")
      .withIndex("by_state_updated", (q) => q.eq("state", "failed").gt("updatedAt", now - FAILED_WINDOW))
      .order("desc")
      .take(100);
    return [...stuck, ...failed].map((task) => ref("activationTasks", task._id));
  },
  async evaluate(ctx, source, now) {
    const task = await load(ctx, "activationTasks", source);
    if (!task) return null;
    if (task.state === "working" && task.leaseUntil !== undefined && task.leaseUntil < now - LEASE_STUCK) {
      return {
        key: `agent_task_lease_expired:${task.companyId}`,
        kind: "agent_task_lease_expired",
        area: "agents",
        companyId: task.companyId,
        severity: "high",
        state: "needs_staff",
        title: `${agentName(task.agent)} first work stopped reporting`,
        impact: `“${task.title}” has not moved for ${ago(now - task.leaseUntil)}. Nothing it made has been lost.`,
        nextAction: "The activation recovery job should have retried this step 30 seconds after its lease ran out. Check that the job is running.",
        diagnostics: `task ${task._id}, attempt ${task.attempts}, lease ended ${new Date(task.leaseUntil).toISOString()}`,
        source,
        since: task.leaseUntil,
        attempts: task.attempts,
        plural: (n) => ({ title: `${many(n, "agent step", "agent steps")} stopped reporting`, impact: `${many(n, "piece", "pieces")} of first agent work have not moved. Nothing they made has been lost.` }),
      };
    }
    if (task.state === "failed") {
      return {
        key: `agent_task_failed:${task.companyId}`,
        kind: "agent_task_failed",
        area: "agents",
        companyId: task.companyId,
        severity: "medium",
        state: "needs_staff",
        title: `${agentName(task.agent)} could not finish “${task.title}”`,
        impact: "This first piece of agent work stopped after its retries. The owner sees it as not finished.",
        nextAction: "Read the last error, fix the cause, and have the owner start it again. Close this once it is handled.",
        diagnostics: task.lastError ? `last error: ${task.lastError.slice(0, 300)}` : undefined,
        source,
        since: task.updatedAt,
        attempts: task.attempts,
        plural: (n) => ({ title: `${many(n, "piece", "pieces")} of agent work failed after retries`, impact: "First agent work stopped after its retries. The owner sees it as not finished." }),
      };
    }
    return null;
  },
};

/** The chat sweep (every 2 minutes) closes a response whose heartbeat is 3 minutes old. Fifteen minutes means it is not running. */
const CHAT_STUCK = 15 * MINUTE;

const chatRuns: Detector = {
  check: "chat_runs",
  everyMinutes: 5,
  async scan(ctx, now) {
    const out: Related[] = [];
    for (const status of ["running", "queued"] as const) {
      const rows = await ctx.db
        .query("chatRuns")
        .withIndex("by_status_heartbeat", (q) => q.eq("status", status).lt("heartbeatAt", now - CHAT_STUCK))
        .take(50);
      out.push(...rows.map((run) => ref("chatRuns", run._id)));
    }
    return out;
  },
  async evaluate(ctx, source, now) {
    const run = await load(ctx, "chatRuns", source);
    if (!run || (run.status !== "running" && run.status !== "queued") || run.heartbeatAt >= now - CHAT_STUCK) return null;
    return {
      key: "chat_run_not_closed",
      kind: "chat_run_not_closed",
      area: "platform",
      severity: "medium",
      state: "needs_staff",
      title: "A chat response was never closed",
      impact: "A person sees a Company Chat answer still working. Actions it already carried out are not repeated.",
      nextAction: "The job that closes interrupted chat responses (every 2 minutes) is not keeping up. Check the scheduled jobs.",
      diagnostics: `run ${run._id}, last heartbeat ${new Date(run.heartbeatAt).toISOString()}`,
      source,
      since: run.heartbeatAt,
      attempts: 0,
      plural: (n) => ({ title: `${many(n, "chat response was", "chat responses were")} never closed`, impact: "People see Company Chat answers still working. Actions already carried out are not repeated." }),
    };
  },
};

// ── Communications ────────────────────────────────────────────────────────────────────────────────

/** A delivery report usually arrives within minutes. After an hour without one, a person checks the provider. */
const RECEIPT_WAIT = HOUR;

const uncertainMessages: Detector = {
  check: "uncertain_messages",
  everyMinutes: 10,
  async scan(ctx) {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_status_attempted", (q) => q.eq("status", "unconfirmed"))
      .order("desc")
      .take(200);
    return rows.filter((row) => row.purpose !== "member_notice").map((row) => ref("messages", row._id));
  },
  async evaluate(ctx, source, now) {
    const message = await load(ctx, "messages", source);
    if (!message || message.status !== "unconfirmed" || message.purpose === "member_notice") return null;
    const since = message.attemptedAt ?? message.queuedAt;
    const waiting = now - since < RECEIPT_WAIT;
    const route = message.sentVia ?? message.provider;
    return {
      key: `message_unconfirmed:${message.companyId}`,
      kind: "message_unconfirmed",
      area: "communications",
      companyId: message.companyId,
      provider: route,
      severity: "medium",
      state: waiting ? "recovering" : "needs_staff",
      title: "A message's delivery is not confirmed",
      impact: "It is not known whether one message reached its recipient. It is not being sent again.",
      nextAction: waiting
        ? "Waiting for the provider's delivery report, which settles it either way."
        : "No delivery report arrived. Look the message up at the provider before anyone sends it again.",
      diagnostics: `message ${message._id} (${message.purpose}, ${message.channel ?? "sms"} via ${route ?? "unknown"}${message.providerMessageId ? `, provider id ${message.providerMessageId}` : ", no provider id"})`,
      source,
      since,
      attempts: message.attempts,
      plural: (n) => ({ title: `${many(n, "message's delivery is", "messages' delivery is")} not confirmed`, impact: `It is not known whether ${many(n, "message", "messages")} reached their recipients. None is being sent again.` }),
    };
  },
};

const NOTICE_WINDOW = DAY;
const NOTICE_FAILURES = 3;

const ownerNotices: Detector = {
  check: "owner_notices",
  everyMinutes: 15,
  async scan(ctx, now) {
    const failed = await ctx.db
      .query("messages")
      .withIndex("by_status_attempted", (q) => q.eq("status", "failed").gt("attemptedAt", now - NOTICE_WINDOW))
      .take(300);
    const members = new Set<string>();
    for (const row of failed) if (row.purpose === "member_notice" && row.memberId) members.add(row.memberId);
    return [...members].map((id) => ref("members", id));
  },
  async evaluate(ctx, source, now) {
    const member = await load(ctx, "members", source);
    if (!member || member.status !== "active") return null;
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_company_member", (q) => q.eq("companyId", member.companyId).eq("memberId", member._id).gt("queuedAt", now - NOTICE_WINDOW))
      .order("desc")
      .take(50);
    const notices = recent.filter((row) => row.purpose === "member_notice");
    const failures = notices.filter((row) => row.status === "failed");
    if (failures.length < NOTICE_FAILURES) return null;
    // A notice that went through after the last failure means the address works again.
    const lastFailure = Math.max(...failures.map((row) => row.queuedAt));
    if (notices.some((row) => (row.status === "sent" || row.status === "delivered") && row.queuedAt > lastFailure)) return null;
    const address = member.email ? maskAddress("email", member.email) : "their address";
    return {
      key: `owner_notice_failing:${member._id}`,
      kind: "owner_notice_failing",
      area: "communications",
      companyId: member.companyId,
      provider: "resend",
      severity: member.role === "owner" ? "high" : "medium",
      state: "needs_staff",
      title: `Notifications to the company's ${member.role} are failing`,
      impact: `${many(failures.length, "notification", "notifications")} to ${address} failed in the last day. They may not know about decisions waiting for them.`,
      nextAction: "Check the sending provider's record for this address (bounce, suppression, mailbox full) and ask the company for a working address.",
      diagnostics: failures[0].problem ? `last problem: ${failures[0].problem.slice(0, 200)}` : undefined,
      source,
      since: Math.min(...failures.map((row) => row.queuedAt)),
      attempts: failures.length,
    };
  },
};

/** The stuck-send job (every 5 minutes) marks a send unconfirmed 5 minutes after it started. Twenty minutes means it is not running. */
const SENDING_STUCK = 20 * MINUTE;

const stuckSends: Detector = {
  check: "stuck_sends",
  everyMinutes: 5,
  async scan() {
    return [ref("platform", "stuck_sends")];
  },
  async evaluate(ctx, source, now) {
    if (source.table !== "platform" || source.id !== "stuck_sends") return null;
    const stuck = await ctx.db
      .query("messages")
      .withIndex("by_status_attempted", (q) => q.eq("status", "sending").lt("attemptedAt", now - SENDING_STUCK))
      .take(20);
    if (stuck.length === 0) return null;
    const oldest = stuck[0].attemptedAt ?? now;
    return {
      key: "send_recovery_stopped",
      kind: "send_recovery_stopped",
      area: "platform",
      severity: "high",
      state: "needs_staff",
      title: "Stuck-send recovery has stopped",
      impact: `${many(stuck.length, "message has", "messages have")}${stuck.length === 20 ? " (or more)" : ""} been “sending” for over 20 minutes. They are not being sent again, but nobody has been told.`,
      nextAction: "Check that the “find sends that never finished” job is running and not failing.",
      diagnostics: `oldest started ${new Date(oldest).toISOString()}`,
      source,
      since: oldest,
      attempts: 0,
    };
  },
};

const SIGNAL_WINDOW = 30 * MINUTE;
const SIGNAL_FAILURES = 3;
const SIGNAL_ESCALATE = 10;

function providerOfPath(path: string): string | undefined {
  const match = /^\/webhooks\/([a-z-]+)/.exec(path);
  if (!match) return undefined;
  return match[1] === "stripe-billing" ? "stripe" : match[1];
}

const inboundProcessing: Detector = {
  check: "inbound_processing",
  everyMinutes: 5,
  async scan(ctx, now) {
    const rows = await ctx.db
      .query("opsSignals")
      .withIndex("by_kind_at", (q) => q.eq("kind", "webhook_failed").gt("at", now - SIGNAL_WINDOW))
      .take(500);
    return [...new Set(rows.map((row) => row.source))].map((path) => ref("webhook", path));
  },
  async evaluate(ctx, source, now) {
    if (source.table !== "webhook") return null;
    const rows = await ctx.db
      .query("opsSignals")
      .withIndex("by_kind_at", (q) => q.eq("kind", "webhook_failed").gt("at", now - SIGNAL_WINDOW))
      .take(500);
    const mine = rows.filter((row) => row.source === source.id);
    if (mine.length < SIGNAL_FAILURES) return null;
    return {
      key: `inbound_processing_failed:${source.id}`,
      kind: "inbound_processing_failed",
      area: "communications",
      provider: providerOfPath(source.id),
      severity: "high",
      state: mine.length >= SIGNAL_ESCALATE ? "needs_staff" : "investigating",
      title: `Callbacks to ${source.id} are failing`,
      impact: `${many(mine.length, "callback", "callbacks")} could not be processed in the last 30 minutes: replies, delivery reports or status changes from this provider may be late. The provider sends each one again.`,
      nextAction: mine.length >= SIGNAL_ESCALATE ? "Read the backend logs for this route and fix the cause. Callbacks the provider retries are processed once it works." : "Watching: the provider retries failed callbacks.",
      diagnostics: `last error: ${mine[mine.length - 1].detail}`,
      source,
      since: mine[0].at,
      attempts: mine.length,
    };
  },
};

// ── Texting registration ──────────────────────────────────────────────────────────────────────────

const TEXTING_STALL = 2 * HOUR;
/** The registration reconcile reads a quiet registration back from Telnyx every six hours. Twelve without a check means it is not. */
const CARRIER_UNCHECKED = 12 * HOUR;
const NUMBER_CONNECT_WAIT = HOUR;

const texting: Detector = {
  check: "texting",
  everyMinutes: 15,
  async scan(ctx) {
    const out: Related[] = [];
    for (const status of ["needs_you", "interrupted", "failed", "provisioning", "approved", "waiting_on_carriers"] as const) {
      const rows = await ctx.db
        .query("textingRequests")
        .withIndex("by_status_requested", (q) => q.eq("status", status))
        .take(200);
      out.push(...rows.map((row) => ref("textingRequests", row._id)));
    }
    return out;
  },
  async evaluate(ctx, source, now) {
    const request = await load(ctx, "textingRequests", source);
    if (!request) return null;
    const base = { area: "communications" as const, companyId: request.companyId, provider: "telnyx", source, attempts: request.resubmissions ?? 0 };
    const diagnostics = request.diagnostics ? `brand ${request.diagnostics.brand ?? "-"}, campaign ${request.diagnostics.campaign ?? "-"}, assignment ${request.diagnostics.assignment ?? "-"}, order ${request.diagnostics.order ?? "-"}` : undefined;
    const updated = request.updatedAt ?? request.requestedAt;
    if (request.status === "needs_you") {
      const needs = request.needs;
      const what = needs?.kind === "code" ? "the one-time code the carriers sent to the owner's mobile" : needs?.kind === "number" ? "a new number choice" : `corrected details${needs?.fields.length ? ` (${needs.fields.join(", ")})` : ""}`;
      return { ...base, key: `texting_needs_owner:${request._id}`, kind: "texting_needs_owner", severity: "medium", state: "waiting_owner", title: "Texting registration needs the owner", impact: `Business texting is on hold until the owner provides ${what}. Their earlier answers are kept.`, nextAction: "The owner completes the step in Texting setup.", diagnostics, since: needs?.at ?? updated };
    }
    if (request.status === "interrupted") {
      return { ...base, key: `texting_interrupted:${request._id}`, kind: "texting_interrupted", severity: "high", state: "waiting_provider", title: "Carriers interrupted this company's texting", impact: "Texts from this company are stopped until the registration is restored. Nothing is queued to go out all at once afterwards.", nextAction: "Read the carrier's reason in the diagnostics and help the owner correct the registration.", diagnostics, since: updated };
    }
    if (request.status === "failed") {
      return { ...base, key: `texting_failed:${request._id}`, kind: "texting_failed", severity: "high", state: "needs_staff", title: "Texting setup failed", impact: "This company cannot text customers or cleaners.", nextAction: "Read the problem, fix the cause at Telnyx or with the owner, and start provisioning again. Close this once handled.", diagnostics: [request.problem, diagnostics].filter(Boolean).join(" · ") || undefined, since: updated };
    }
    if ((request.status === "provisioning" || request.status === "approved") && (request.leaseUntil ?? 0) < now && updated < now - TEXTING_STALL) {
      return { ...base, key: `texting_stalled:${request._id}`, kind: "texting_stalled", severity: "medium", state: "needs_staff", title: "Texting setup is not progressing", impact: `Setup has been at “${request.step ?? request.status}” for ${ago(now - updated)} with nothing running.`, nextAction: "Check the provisioning step's last attempt (look at Telnyx before trying again: a create call may have gone through).", diagnostics, since: updated };
    }
    if (request.status === "waiting_on_carriers") {
      if (request.campaignApprovedAt && !request.assignedAt && request.campaignApprovedAt < now - NUMBER_CONNECT_WAIT) {
        return { ...base, key: `texting_number_not_connected:${request._id}`, kind: "texting_number_not_connected", severity: "high", state: "needs_staff", title: "Campaign approved, number not connected", impact: "The carriers approved the campaign, but the company's number is not attached to it yet, so texting cannot start.", nextAction: "Check the number's campaign assignment at Telnyx.", diagnostics, since: request.campaignApprovedAt };
      }
      const checked = request.lastCheckedAt ?? request.requestedAt;
      if (checked < now - CARRIER_UNCHECKED) {
        return { ...base, key: `texting_stalled:${request._id}`, kind: "texting_stalled", severity: "medium", state: "needs_staff", title: "Registration status is not being checked", impact: `The carriers' decision has not been read back for ${ago(now - checked)}. Approval may already have come.`, nextAction: "Check that the “texting registrations reconcile” job is running.", diagnostics, since: checked };
      }
      // Waiting for the carriers' review, and being checked: normal.
      return null;
    }
    return null;
  },
};

// ── Connections ───────────────────────────────────────────────────────────────────────────────────

const MAILBOX_FAILURES = 3;
const MAILBOX_ESCALATE = 6;

function inboxWork(purposes: readonly string[] | undefined): string {
  const list = purposes && purposes.length > 0 ? purposes : ["hiring"];
  const parts: string[] = [];
  if (list.includes("hiring")) parts.push("Recruiter cannot check new applications");
  if (list.includes("care")) parts.push("Care & Retention cannot read customer replies");
  if (list.includes("sales")) parts.push("Sales cannot read new inquiries");
  if (list.includes("operations")) parts.push("operations mail is not being read");
  return parts.join("; ");
}

const mailboxes: Detector = {
  check: "mailboxes",
  everyMinutes: 10,
  async scan(ctx) {
    const out: Related[] = [];
    for (const status of ["expired", "error"] as const) {
      const rows = await ctx.db
        .query("mailboxConnections")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(200);
      out.push(...rows.map((row) => ref("mailboxConnections", row._id)));
    }
    const connected = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_status", (q) => q.eq("status", "connected"))
      .take(1000);
    out.push(...connected.filter((row) => row.failures >= MAILBOX_FAILURES).map((row) => ref("mailboxConnections", row._id)));
    return out;
  },
  async evaluate(ctx, source) {
    const box = await load(ctx, "mailboxConnections", source);
    if (!box || box.provider === "mock") return null;
    const base = { area: "connections" as const, companyId: box.companyId, provider: box.provider, source, attempts: box.failures, diagnostics: `${maskAddress("email", box.address)}${box.problem ? ` · ${box.problem.slice(0, 200)}` : ""}` };
    const work = inboxWork(box.purposes);
    if (box.status === "expired") {
      return { ...base, key: `mailbox_reconnect:${box._id}`, kind: "mailbox_reconnect", severity: "high", state: "waiting_owner", title: `The ${box.provider === "gmail" ? "Gmail" : "Outlook"} inbox needs reconnecting`, impact: `${work}. Everything already read is saved.`, nextAction: "The owner reconnects the inbox. Reading picks up where it stopped.", since: box.lastSyncAt ?? box.createdAt };
    }
    if (box.status === "error" || box.failures >= MAILBOX_FAILURES) {
      const escalate = box.status === "error" || box.failures >= MAILBOX_ESCALATE;
      return { ...base, key: `mailbox_read_failing:${box._id}`, kind: "mailbox_read_failing", severity: "medium", state: escalate ? "needs_staff" : "recovering", title: "Inbox reads are failing", impact: `${work} while reads fail. Everything already read is saved.`, nextAction: escalate ? "Reads keep failing. Read the problem and check the provider." : "The inbox is read again every 10 minutes.", since: box.lastSyncAt ?? box.createdAt };
    }
    return null;
  },
};

const GOOGLE_FEATURE_WORK: Record<string, string> = {
  drive: "Documents are not being saved to or read from Google Drive",
  calendar: "Visits are not being synced with Google Calendar",
  business_profile: "Google reviews are not being read or answered",
  ads: "Google Ads drafts and reports are paused",
  conversions: "Booked jobs are not being reported to Google Ads",
};
const GOOGLE_UNCERTAIN = HOUR;

const google: Detector = {
  check: "google",
  everyMinutes: 10,
  async scan(ctx, now) {
    const out: Related[] = [];
    const expired = await ctx.db
      .query("googleConnections")
      .withIndex("by_status", (q) => q.eq("status", "expired"))
      .take(200);
    out.push(...expired.map((row) => ref("googleConnections", row._id)));
    for (const status of ["failed", "uncertain"] as const) {
      const rows = await ctx.db
        .query("googleJobs")
        .withIndex("by_status_next", (q) => q.eq("status", status))
        .order("desc")
        .take(200);
      out.push(...rows.filter((row) => status === "uncertain" || row.updatedAt > now - FAILED_WINDOW).map((row) => ref("googleJobs", row._id)));
    }
    return out;
  },
  async evaluate(ctx, source, now) {
    const connection = await load(ctx, "googleConnections", source);
    if (connection) {
      if (connection.status !== "expired") return null;
      const work = GOOGLE_FEATURE_WORK[connection.feature ?? "drive"] ?? "Google work is paused";
      return { key: `google_reconnect:${connection._id}`, kind: "google_reconnect", area: "connections", companyId: connection.companyId, provider: "google", severity: "medium", state: "waiting_owner", title: "Google needs reconnecting", impact: `${work}. Nothing already saved is lost.`, nextAction: "The owner reconnects Google for this tool.", diagnostics: `${connection.feature ?? "legacy"} · ${maskAddress("email", connection.email)}${connection.problem ? ` · ${connection.problem.slice(0, 200)}` : ""}`, source, since: connection.lastRefreshAt ?? connection.connectedAt, attempts: 0 };
    }
    const job = await load(ctx, "googleJobs", source);
    if (!job) return null;
    if (job.status === "uncertain") {
      const waiting = job.updatedAt > now - GOOGLE_UNCERTAIN;
      return { key: `google_job_uncertain:${job.companyId}`, kind: "google_job_uncertain", area: "connections", companyId: job.companyId, provider: "google", severity: "medium", state: waiting ? "recovering" : "needs_staff", title: "A Google write's outcome is unknown", impact: "Google may or may not have made one change. It is checked by its key before anything is tried again.", nextAction: waiting ? "Waiting for the reconcile by key." : "The reconcile has not settled it in an hour. Look the change up in Google.", diagnostics: `${job.kind} job ${job._id}${job.lastError ? ` · ${job.lastError.slice(0, 200)}` : ""}`, source, since: job.updatedAt, attempts: job.attempts, plural: (n) => ({ title: `${many(n, "Google write's", "Google writes'")} outcome unknown`, impact: `Google may or may not have made ${many(n, "change", "changes")}. Each is checked by its key before anything is tried again.` }) };
    }
    if (job.status === "failed" && job.updatedAt > now - FAILED_WINDOW) {
      const linked = job.connectionId ? await ctx.db.get(job.connectionId) : null;
      const expired = linked?.status === "expired";
      return { key: `google_job_failed:${job.companyId}:${job.kind}`, kind: "google_job_failed", area: "connections", companyId: job.companyId, provider: "google", severity: "low", state: expired ? "waiting_owner" : "needs_staff", title: `Google ${job.kind.replace(/_/g, " ")} failed`, impact: "One piece of Google work stopped after its retries.", nextAction: expired ? "Waits for the owner to reconnect Google." : "Read the error and fix the cause. Close this once handled.", diagnostics: `job ${job._id}${job.lastError ? ` · ${job.lastError.slice(0, 200)}` : ""}`, source, since: job.updatedAt, attempts: job.attempts, plural: (n) => ({ title: `Google ${job.kind.replace(/_/g, " ")} failed ${many(n, "time", "times")}`, impact: `${many(n, "piece", "pieces")} of Google work stopped after their retries.` }) };
    }
    return null;
  },
};

const connectors: Detector = {
  check: "connectors",
  everyMinutes: 15,
  async scan(ctx) {
    const rows = await ctx.db
      .query("connectorConnections")
      .withIndex("by_status", (q) => q.eq("status", "expired"))
      .take(200);
    return rows.map((row) => ref("connectorConnections", row._id));
  },
  async evaluate(ctx, source) {
    const connection = await load(ctx, "connectorConnections", source);
    if (!connection || connection.status !== "expired") return null;
    const system = connection.system === "jobber" ? "Jobber" : "Housecall Pro";
    return { key: `connector_reconnect:${connection._id}`, kind: "connector_reconnect", area: "connections", companyId: connection.companyId, provider: connection.system, severity: "low", state: "waiting_owner", title: `${system} needs reconnecting`, impact: `Clients cannot be imported from ${system}. Clients already imported are kept.`, nextAction: `The owner reconnects ${system}.`, diagnostics: connection.problem?.slice(0, 200), source, since: connection.lastReadAt ?? connection.connectedAt, attempts: 0 };
  },
};

// ── Billing ───────────────────────────────────────────────────────────────────────────────────────

/** The settlement sweeps run every 5 minutes. A settlement due an hour ago means they are not. */
const SETTLE_OVERDUE = HOUR;

const aiBilling: Detector = {
  check: "ai_billing",
  everyMinutes: 10,
  async scan(ctx, now) {
    const out: Related[] = [];
    const unverified = await ctx.db
      .query("aiExecutions")
      .withIndex("by_settlement_next", (q) => q.eq("settlement", "unverified"))
      .take(200);
    out.push(...unverified.map((row) => ref("aiExecutions", row._id)));
    for (const settlement of ["pending_confirm", "pending_release"] as const) {
      const overdue = await ctx.db
        .query("aiExecutions")
        .withIndex("by_settlement_next", (q) => q.eq("settlement", settlement).lt("nextSettleAt", now - SETTLE_OVERDUE))
        .take(50);
      out.push(...overdue.map((row) => ref("aiExecutions", row._id)));
    }
    return out;
  },
  async evaluate(ctx, source, now) {
    const row = await load(ctx, "aiExecutions", source);
    if (!row) return null;
    if (row.settlement === "unverified") {
      return { key: `ai_settlement_unverified:${row.companyId}`, kind: "ai_settlement_unverified", area: "billing", companyId: row.companyId, provider: "autumn", severity: "medium", state: "needs_staff", title: "An AI credit charge is unsettled", impact: "The work finished; only its charge could not be confirmed with Autumn after every retry. The work will not run again.", nextAction: "Compare with Autumn's usage record, then confirm or release the hold.", diagnostics: `execution ${row._id} (${row.task}, ${row.credits} credits)${row.settleProblem ? ` · ${row.settleProblem.slice(0, 200)}` : ""}`, source, since: row.updatedAt, attempts: row.settleAttempts, plural: (n) => ({ title: `${many(n, "AI credit charge is", "AI credit charges are")} unsettled`, impact: "The work finished; only the charges could not be confirmed with Autumn after every retry. Nothing will run again." }) };
    }
    if ((row.settlement === "pending_confirm" || row.settlement === "pending_release") && row.nextSettleAt !== undefined && row.nextSettleAt < now - SETTLE_OVERDUE) {
      return { key: "ai_settlement_overdue", kind: "ai_settlement_overdue", area: "platform", provider: "autumn", severity: "high", state: "needs_staff", title: "AI credit settlements are overdue", impact: "Credit holds are waiting to be confirmed or released. Owners' available credits may look lower than they are.", nextAction: "Check that the “billing settles and recovers AI work” job is running.", diagnostics: `oldest due ${new Date(row.nextSettleAt).toISOString()}`, source, since: row.nextSettleAt, attempts: row.settleAttempts };
    }
    return null;
  },
};

const messagingBilling: Detector = {
  check: "messaging_billing",
  everyMinutes: 10,
  async scan(ctx, now) {
    const out: Related[] = [];
    const unverified = await ctx.db
      .query("messagingCharges")
      .withIndex("by_settlement_next", (q) => q.eq("settlement", "unverified"))
      .take(200);
    out.push(...unverified.map((row) => ref("messagingCharges", row._id)));
    for (const settlement of ["pending_confirm", "pending_release", "pending_track"] as const) {
      const overdue = await ctx.db
        .query("messagingCharges")
        .withIndex("by_settlement_next", (q) => q.eq("settlement", settlement).lt("nextSettleAt", now - SETTLE_OVERDUE))
        .take(50);
      out.push(...overdue.map((row) => ref("messagingCharges", row._id)));
    }
    return out;
  },
  async evaluate(ctx, source, now) {
    const row = await load(ctx, "messagingCharges", source);
    if (!row) return null;
    if (row.settlement === "unverified") {
      return { key: `messaging_settlement_unverified:${row.companyId}`, kind: "messaging_settlement_unverified", area: "billing", companyId: row.companyId, provider: "autumn", severity: "medium", state: "needs_staff", title: "A messaging charge is unsettled", impact: "The message itself is unaffected; only its charge could not be confirmed after every retry. It will not be sent again.", nextAction: "Compare with Autumn's record, then settle the charge.", diagnostics: `charge ${row._id} (${row.state})${row.settleProblem ? ` · ${row.settleProblem.slice(0, 200)}` : ""}`, source, since: row.updatedAt, attempts: row.settleAttempts, plural: (n) => ({ title: `${many(n, "messaging charge is", "messaging charges are")} unsettled`, impact: "The messages are unaffected; only their charges could not be confirmed after every retry. None will be sent again." }) };
    }
    if ((row.settlement === "pending_confirm" || row.settlement === "pending_release" || row.settlement === "pending_track") && row.nextSettleAt !== undefined && row.nextSettleAt < now - SETTLE_OVERDUE) {
      return { key: "messaging_settlement_overdue", kind: "messaging_settlement_overdue", area: "platform", provider: "autumn", severity: "high", state: "needs_staff", title: "Messaging settlements are overdue", impact: "Messaging holds are waiting to be settled. Owners' messaging balances may be off until they are.", nextAction: "Check that the “messaging charges settle and recover” job is running.", diagnostics: `oldest due ${new Date(row.nextSettleAt).toISOString()}`, source, since: row.nextSettleAt, attempts: row.settleAttempts };
    }
    return null;
  },
};

const messagingAttention: Detector = {
  check: "messaging_attention",
  everyMinutes: 10,
  async scan(ctx) {
    const rows = await ctx.db
      .query("messagingAttention")
      .withIndex("by_resolved_at", (q) => q.eq("resolvedAt", 0))
      .take(200);
    return rows.map((row) => ref("messagingAttention", row._id));
  },
  async evaluate(ctx, source) {
    const row = await load(ctx, "messagingAttention", source);
    if (!row || row.resolvedAt !== 0) return null;
    if (row.kind === "overdraft_floor") {
      return { key: `messaging_overdraft_floor:${row._id}`, kind: "messaging_overdraft_floor", area: "billing", companyId: row.companyId, severity: "high", state: "needs_staff", title: "Messaging balance reached the overdraft floor", impact: "Incoming texts took the balance to its floor. Outgoing texts wait for funds; incoming texts, opt-outs and delivery reports keep working.", nextAction: "Review the account and resolve it in Staff › Messaging.", diagnostics: row.detail.slice(0, 300), source, since: row.at, attempts: 0 };
    }
    return { key: `messaging_inbound_spike:${row._id}`, kind: "messaging_inbound_spike", area: "communications", companyId: row.companyId, severity: "medium", state: "needs_staff", title: "Unusual burst of incoming texts", impact: "Many texts arrived at once; it may be abuse. Each one is still processed and opt-outs are honored.", nextAction: "Review the traffic and resolve it in Staff › Messaging.", diagnostics: row.detail.slice(0, 300), source, since: row.at, attempts: 0 };
  },
};

export const DETECTORS: readonly Detector[] = [
  agentWork,
  chatRuns,
  uncertainMessages,
  ownerNotices,
  stuckSends,
  inboundProcessing,
  mailboxes,
  google,
  connectors,
  texting,
  aiBilling,
  messagingBilling,
  messagingAttention,
];

export function detectorFor(check: Check): Detector {
  const found = DETECTORS.find((detector) => detector.check === check);
  if (!found) throw new Error(`No detector for ${check}`);
  return found;
}

