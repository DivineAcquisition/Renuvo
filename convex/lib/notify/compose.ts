/**
 * Writing a notice at the moment it goes (convex/lib/notify/route.ts plans it). Everything is read again
 * now: the person must still be a member with the setting still on, the address not suppressed, and the
 * thing it's about still true (an approval still undecided, an inbox still disconnected). Otherwise the
 * notice isn't sent, and the row says why.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { platformSender } from "../email/senders";
import { agentApprovalEmail, alertEmail, inboxReconnectEmail, paymentFailureEmail, securityEmail, welcomeEmail, type SecurityChange } from "../email/templates/platform";
import { money, type AgentId, type Email, type MemberRole } from "../email/templates/shared";
import { readProfile } from "../compliance/profile";
import { appOrigin } from "../invitations";
import { quietUntil } from "../messaging/policy";
import { roleOf } from "../roles";
import { CATEGORY_INFO, EVENT_INFO, NIGHT, type NoticeFacts } from "./catalog";
import { emailOn, noticeSuppression, preferencesOf, SUPPRESSION_WORDS } from "./preferences";
import { unsubscribable } from "./route";
import { unsubscribeFor } from "./unsubscribe";
import { waitingMessages } from "../inbox/events";

export type Composed =
  | { ok: true; email: Email; from: string; replyTo?: string; headers: Record<string, string> }
  | { ok: false; problem: string; refusal?: string; retryAt?: number };

type Context = { companyName: string; timezone: string; role: MemberRole; origin: string | null; unsubscribeUrl: string | null };
type Built = Email | { problem: string };

const str = (facts: NoticeFacts | undefined, key: string): string | null => {
  const value = facts?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};
const num = (facts: NoticeFacts | undefined, key: string): number | null => {
  const value = facts?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const list = (facts: NoticeFacts | undefined, key: string): string[] =>
  (str(facts, key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function welcome(ctx: MutationCtx, company: Doc<"companies">, member: Doc<"members">, c: Context): Promise<Built> {
  // Each is read through its company index; one row is enough to know.
  const services = await ctx.db.query("services").withIndex("by_company_key", (q) => q.eq("companyId", company._id)).first();
  const cleaners = await ctx.db.query("cleaners").withIndex("by_company_status", (q) => q.eq("companyId", company._id)).first();
  const authority = await ctx.db.query("permissions").withIndex("by_company_action", (q) => q.eq("companyId", company._id)).first();
  const profile = await readProfile(ctx, company._id);
  return welcomeEmail({
    ...c,
    ownerName: member.name,
    steps: [
      { label: "Company created and terms accepted", done: true },
      { label: "Add your services and prices", done: services !== null },
      { label: "Add your cleaners", done: cleaners !== null },
      { label: "Connect your texting number", done: Boolean(profile.messaging.smsNumber) },
      { label: "Choose what each agent may do on its own", done: authority !== null },
    ],
  });
}

function securityChange(facts: NoticeFacts | undefined): SecurityChange | null {
  switch (str(facts, "kind")) {
    case "role_changed":
      return str(facts, "memberName") && str(facts, "from") && str(facts, "to") ? { kind: "role_changed", memberName: str(facts, "memberName")!, from: str(facts, "from")!, to: str(facts, "to")! } : null;
    case "member_removed":
      return str(facts, "memberName") ? { kind: "member_removed", memberName: str(facts, "memberName")! } : null;
    case "inbox_connected":
      return str(facts, "address") ? { kind: "inbox_connected", address: str(facts, "address")!, purposes: list(facts, "purposes") } : null;
    case "inbox_disconnected":
      return str(facts, "address") ? { kind: "inbox_disconnected", address: str(facts, "address")! } : null;
    case "payout_account_changed":
      return { kind: "payout_account_changed", accountEnding: str(facts, "accountEnding") };
    case "deletion_requested":
      return num(facts, "deleteAfter") ? { kind: "deletion_requested", deleteAfter: num(facts, "deleteAfter")! } : null;
    case "export_ready":
      return num(facts, "expiresAt") ? { kind: "export_ready", expiresAt: num(facts, "expiresAt")! } : null;
    default:
      return null;
  }
}

/** Words for what an approval is about, from the record it names. */
async function aboutRows(ctx: MutationCtx, about: Doc<"approvals">["about"]): Promise<{ label: string; value: string | null }[]> {
  if (!about) return [];
  if (about.table === "customers") return [{ label: "Customer", value: (await ctx.db.get(about.id))?.name ?? null }];
  if (about.table === "cleaners") return [{ label: "Cleaner", value: (await ctx.db.get(about.id))?.name ?? null }];
  if (about.table === "jobs") {
    const job = await ctx.db.get(about.id);
    const customer = job ? await ctx.db.get(job.customerId) : null;
    return [{ label: "Visit", value: job ? (job.serviceSnapshot?.name ?? job.serviceType) : null }, { label: "Customer", value: customer?.name ?? null }];
  }
  return [];
}

async function approval(ctx: MutationCtx, ref: string | undefined, reminder: boolean, c: Context): Promise<Built> {
  const id = ref ? ctx.db.normalizeId("approvals", ref) : null;
  const row = id ? await ctx.db.get(id) : null;
  if (!row) return { problem: "The proposal no longer exists." };
  if (row.status !== "pending") return { problem: "The proposal was decided before this notice went." };
  if (row.decideBy <= Date.now()) return { problem: "The proposal's deadline passed before this notice went." };
  return agentApprovalEmail({ ...c, agent: row.agent as AgentId, approvalId: row._id, summary: row.summary, reason: row.reason, authorizes: row.authorizes, ifWaiting: row.ifWaiting, decideBy: row.decideBy, about: await aboutRows(ctx, row.about), reminder });
}

async function planPaymentFailed(ctx: MutationCtx, company: Doc<"companies">, facts: NoticeFacts | undefined, c: Context): Promise<Built> {
  const accounts = await ctx.db
    .query("billingAccounts")
    .withIndex("by_company_env", (q) => q.eq("companyId", company._id))
    .take(5);
  const pastDue = accounts.some((a) => a.subscription.pastDue);
  if (!pastDue) return { problem: "The payment was settled before this notice went." };
  return paymentFailureEmail({ ...c, planName: str(facts, "planName") ?? "Selestial", amountDueCents: num(facts, "amountDueCents"), failedAt: num(facts, "failedAt") ?? Date.now(), cardEnding: str(facts, "cardEnding"), pausesAt: num(facts, "pausesAt") });
}

async function inboxReconnect(ctx: MutationCtx, ref: string | undefined, facts: NoticeFacts | undefined, c: Context): Promise<Built> {
  const id = ref ? ctx.db.normalizeId("mailboxConnections", ref) : null;
  const mailbox = id ? await ctx.db.get(id) : null;
  if (!mailbox) return { problem: "The inbox is no longer connected to this company." };
  if (mailbox.status === "connected") return { problem: "The inbox was reconnected before this notice went." };
  if (mailbox.status === "disconnected") return { problem: "The inbox was disconnected on purpose, so there's nothing to reconnect." };
  const purposes = list(facts, "purposes");
  return inboxReconnectEmail({
    ...c,
    address: mailbox.address,
    purposes: purposes.length ? purposes : ["Hiring"],
    agents: purposes.length ? (list(facts, "agents") as AgentId[]).filter((a) => a in { sales: 1, recruiter: 1, dispatch: 1, retention: 1 }) : ["recruiter"],
    since: num(facts, "since") ?? mailbox.lastSyncAt ?? mailbox.createdAt,
    reason: mailbox.status === "expired" ? "expired" : "error",
    // Counted now, so the notice says how many are waiting at the moment it goes.
    held: (await waitingMessages(ctx, mailbox.companyId)).length,
  });
}

async function build(ctx: MutationCtx, message: Doc<"messages">, company: Doc<"companies">, member: Doc<"members">, c: Context): Promise<Built> {
  const notice = message.notice!;
  const facts = notice.facts;
  switch (notice.event) {
    case "welcome":
      return welcome(ctx, company, member, c);
    case "security_change": {
      const change = securityChange(facts);
      if (!change) return { problem: "The notice didn't say what changed, so it wasn't sent." };
      return securityEmail({ ...c, change, byName: str(facts, "byName") ?? "Someone in your company", at: num(facts, "at") ?? message.queuedAt });
    }
    case "approval_needed":
      return approval(ctx, notice.ref, false, c);
    case "approval_expiring":
      return approval(ctx, notice.ref, true, c);
    case "plan_payment_failed":
      return planPaymentFailed(ctx, company, facts, c);
    case "credits_exhausted":
      return alertEmail({
        ...c,
        eyebrow: "Billing",
        subject: "Selestial Credits ran out, so AI work is paused",
        heading: "Your credits ran out",
        body: "New AI work is paused until you add credits or the monthly allowance resets.",
        tone: "warning",
        note: "Schedules, records, cleaner links and everything that doesn't use AI keep working.",
        button: { label: "Add credits", path: "/app/settings/billing" },
        essential: true,
      });
    case "customer_payment_failed": {
      const amount = num(facts, "amountCents");
      const customer = str(facts, "customerName");
      return alertEmail({
        ...c,
        eyebrow: "Payments",
        subject: `A payment from ${customer ?? "a customer"} didn't go through`,
        heading: "A customer payment didn't go through",
        body: `${customer ?? "A customer"}'s ${amount !== null ? `${money(amount)} ` : ""}card payment was declined. Nothing was charged.`,
        tone: "warning",
        facts: [
          { label: "Customer", value: customer },
          { label: "Amount", value: amount !== null ? money(amount) : null },
          { label: "Invoice", value: str(facts, "invoiceNumber") },
          { label: "Card issuer said", value: str(facts, "reason") },
        ],
        button: { label: "Open the invoice", path: str(facts, "invoiceId") ? `/app/finance?tab=invoices&invoice=${encodeURIComponent(str(facts, "invoiceId")!)}` : "/app/finance?tab=invoices" },
        because: "notices about what your agents and customers did are on",
      });
    }
    case "inbox_reconnect":
      return inboxReconnect(ctx, notice.ref, facts, c);
    case "dispatch_escalation":
    case "weekly_digest":
      return { problem: "This notice isn't sent yet." };
  }
}

/** The notice as it should go now, or why it shouldn't. */
export async function composeNotice(ctx: MutationCtx, message: Doc<"messages">, now: number): Promise<Composed> {
  if (!message.notice || !message.memberId || !message.to) return { ok: false, problem: "The notice is missing who it's for." };
  const member = await ctx.db.get(message.memberId);
  if (!member || member.companyId !== message.companyId || member.status !== "active") return { ok: false, problem: "The person no longer has access to this company." };
  const company = await ctx.db.get(message.companyId);
  if (!company) return { ok: false, problem: "The company no longer exists." };
  const role = roleOf(member.role);
  const info = EVENT_INFO[message.notice.event];
  if (!emailOn(await preferencesOf(ctx, company._id, member._id), info.category, role)) return { ok: false, problem: "Turned off in their notification settings before it went." };
  // An address change since it was planned: it goes to the address on the member now, or not at all.
  if (member.email.trim().toLowerCase() !== message.to) return { ok: false, problem: "The person's email address changed before it went." };
  const suppressed = await noticeSuppression(ctx, message.to);
  if (suppressed) return { ok: false, problem: SUPPRESSION_WORDS[suppressed.reason], refusal: "suppressed" };
  if (info.priority !== "critical") {
    const until = quietUntil(now, company.timezone, NIGHT);
    if (until !== null) return { ok: false, problem: "Waiting for the morning: only critical notices go overnight.", retryAt: until };
  }
  const sender = platformSender();
  if (!sender.ok) return { ok: false, problem: sender.words };
  const unsubscribe = CATEGORY_INFO[info.category].unsubscribable && unsubscribable(message.notice.event) ? await unsubscribeFor(message._id) : null;
  const context: Context = { companyName: company.name, timezone: company.timezone, role, origin: appOrigin(), unsubscribeUrl: unsubscribe?.pageUrl ?? null };
  const built = await build(ctx, message, company, member, context);
  if ("problem" in built) return { ok: false, problem: built.problem };
  return { ok: true, email: built, from: sender.from, ...(sender.replyTo ? { replyTo: sender.replyTo } : {}), headers: unsubscribe?.headers ?? {} };
}

