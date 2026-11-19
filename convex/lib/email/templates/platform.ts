/**
 * Platform notifications: Selestial writing to the people who run a company (docs/email/00-architecture.md §5).
 *
 * Every value comes from the records and is passed in. A template never invents a count, a claim or a
 * deadline, and an empty value is left out rather than filled. Buttons open a page where the person
 * decides; nothing is approved, accepted or changed by opening a link.
 */
import { action, agentStatus, alert, checklist, digestSection, divider, eyebrow, facts, lead, oneLine, paragraph, renderEmail, stats, textLink, title, type Block } from "../kit";
import { AGENT_FACES, appLink, count, dayOf, emailAssets, firstName, listWords, memberFooter, money, timeOf, when, type AgentId, type Email, type MemberRole } from "./shared";

type Recipient = { origin?: string | null; companyName: string; timezone?: string; role: MemberRole; unsubscribeUrl?: string | null };

function platform(origin: string | null | undefined) {
  return { kind: "platform" as const, markUrl: emailAssets(origin).mark };
}

function finish(input: { origin?: string | null; subject: string; preheader: string; blocks: Block[]; footer: ReturnType<typeof memberFooter> }): Email {
  const { html, text } = renderEmail({ identity: platform(input.origin), preheader: input.preheader, blocks: input.blocks, footer: input.footer });
  return { subject: oneLine(input.subject), preheader: oneLine(input.preheader), html, text };
}

// ── Welcome ──────────────────────────────────────────────────────────────────────────────────────

export function welcomeEmail(input: Recipient & { ownerName?: string | null; steps: { label: string; done: boolean }[] }): Email {
  const company = oneLine(input.companyName);
  const first = firstName(input.ownerName);
  const left = input.steps.filter((s) => !s.done).length;
  return finish({
    origin: input.origin,
    subject: `${company} is set up on Selestial`,
    preheader: left ? `Your agents start on review. ${count(left, "step")} left to get going.` : "Your agents start on review. Everything's in place.",
    blocks: [
      eyebrow("Welcome to Selestial"),
      title(first ? `Welcome, ${first}` : "Welcome"),
      lead(`${company} is set up. Your agents start on review: nothing reaches a customer or a cleaner until you approve it.`),
      checklist({ heading: "Getting started", items: input.steps.map((s) => ({ text: s.label, state: s.done ? "done" : "open" })) }),
      action({ label: left ? "Continue setup" : "Open Selestial", url: appLink(input.origin, "/app") ?? "" }),
      paragraph("When an agent needs a decision, we'll email you what it wants to do, why, and what happens if nobody answers. You choose what else reaches you in notification settings."),
    ],
    footer: { reason: `You're getting this because you created ${company} on Selestial.`, preferencesUrl: appLink(input.origin, "/app/settings/notifications") },
  });
}

// ── Security ─────────────────────────────────────────────────────────────────────────────────────

export type SecurityChange =
  | { kind: "role_changed"; memberName: string; from?: string | null; to: string }
  | { kind: "member_removed"; memberName: string }
  | { kind: "inbox_connected"; address: string; purposes: string[] }
  | { kind: "inbox_disconnected"; address: string }
  | { kind: "payout_account_changed"; accountEnding?: string | null }
  | { kind: "deletion_requested"; deleteAfter: number }
  | { kind: "export_ready"; expiresAt: number };

function securityWords(change: SecurityChange, by: string, timezone?: string): { subject: string; heading: string; body: string; rows: { label: string; value: string | null }[]; path: string; button: string } {
  switch (change.kind) {
    case "role_changed":
      return { subject: `${change.memberName}'s role changed to ${change.to}`, heading: "A team member's access changed", body: `${by} changed ${change.memberName}'s role ${change.from ? `from ${change.from} ` : ""}to ${change.to}.`, rows: [{ label: "Person", value: change.memberName }, { label: "New role", value: change.to }, { label: "Previous role", value: change.from ?? null }], path: "/app/settings/people", button: "Review people & access" };
    case "member_removed":
      return { subject: `${change.memberName} no longer has access`, heading: "Someone's access was removed", body: `${by} removed ${change.memberName} from the company. They can't sign in to it any more.`, rows: [{ label: "Person", value: change.memberName }], path: "/app/settings/people", button: "Review people & access" };
    case "inbox_connected":
      return { subject: `${change.address} was connected to Selestial`, heading: "An inbox was connected", body: `${by} connected ${change.address}. Selestial can now read it${change.purposes.length ? ` for ${listWords(change.purposes)}` : ""} and send from it where you allowed.`, rows: [{ label: "Inbox", value: change.address }, { label: "Used for", value: listWords(change.purposes) || null }], path: "/app/settings/integrations?tool=gmail", button: "Review connected inbox" };
    case "inbox_disconnected":
      return { subject: `${change.address} was disconnected from Selestial`, heading: "An inbox was disconnected", body: `${by} disconnected ${change.address}. Selestial no longer reads it or sends from it, and its stored access was deleted.`, rows: [{ label: "Inbox", value: change.address }], path: "/app/settings/integrations?tool=gmail", button: "Review connected inboxes" };
    case "payout_account_changed":
      return { subject: "Your payout account changed", heading: "Where customer payments are paid out changed", body: `${by} changed the bank account that customer payments are paid out to.`, rows: [{ label: "New account", value: change.accountEnding ? `Ending ${change.accountEnding}` : null }], path: "/app/finance", button: "Review payouts" };
    case "deletion_requested":
      return { subject: "Company deletion was requested", heading: "Your company is scheduled for deletion", body: `${by} asked to delete the company and its records. Until ${dayOf(change.deleteAfter, timezone)}, it can still be stopped.`, rows: [{ label: "Deleted on", value: dayOf(change.deleteAfter, timezone) }], path: "/app/settings/compliance", button: "Review the request" };
    case "export_ready":
      return { subject: "Your data export is ready", heading: "Your data export is ready", body: `The export ${by} asked for is ready to download. The download needs you to be signed in.`, rows: [{ label: "Available until", value: dayOf(change.expiresAt, timezone) }], path: "/app/settings/compliance", button: "Download the export" };
  }
}

export function securityEmail(input: Recipient & { change: SecurityChange; byName: string; at: number }): Email {
  const company = oneLine(input.companyName);
  const by = oneLine(input.byName);
  const words = securityWords(input.change, by, input.timezone);
  const expected = input.change.kind !== "export_ready";
  return finish({
    origin: input.origin,
    subject: `Security notice: ${words.subject}`,
    preheader: `${words.body} If you didn't expect this, review it now.`,
    blocks: [
      eyebrow(`Security · ${company}`),
      title(words.heading),
      lead(words.body),
      facts([...words.rows, { label: "Changed by", value: by }, { label: "When", value: when(input.at, input.timezone) }]),
      expected
        ? alert({ tone: "warning", title: "Didn't expect this?", steps: ["Open Selestial and check who has access.", "Remove anyone you don't recognize, and change your password.", "Reply to this email and our team will help."] })
        : { html: "", text: "" },
      action({ label: words.button, url: appLink(input.origin, words.path) ?? "" }),
    ],
    footer: memberFooter({ ...input, essential: true }),
  });
}

// ── Agent approval ───────────────────────────────────────────────────────────────────────────────

export function agentApprovalEmail(input: Recipient & {
  agent: AgentId;
  approvalId: string;
  summary: string;
  reason: string;
  authorizes?: string | null;
  ifWaiting?: string | null;
  decideBy: number;
  about?: { label: string; value: string | null }[];
  /** Hours left, when this is the reminder before the deadline. */
  reminder?: boolean;
}): Email {
  const agent = AGENT_FACES[input.agent].name;
  const summary = oneLine(input.summary);
  const deadline = when(input.decideBy, input.timezone);
  return finish({
    origin: input.origin,
    subject: `${input.reminder ? "Still waiting: " : ""}${agent} needs your decision: ${summary}`,
    preheader: `${oneLine(input.reason)} Decide by ${deadline}.`,
    blocks: [
      agentStatus({ agent, state: input.reminder ? "Still waiting on you" : "Needs your decision", tone: input.reminder ? "warning" : "info", avatarUrl: emailAssets(input.origin).agent(input.agent) }),
      title(summary),
      lead(input.reason),
      facts([...(input.about ?? []), { label: "Decide by", value: deadline }], "Details"),
      input.authorizes ? alert({ tone: "info", title: "Approving lets it", body: input.authorizes }) : { html: "", text: "" },
      input.ifWaiting ? paragraph(`If nobody decides by then: ${input.ifWaiting}`) : { html: "", text: "" },
      action({ label: "Review and decide", url: appLink(input.origin, `/app/approvals?open=approval:${encodeURIComponent(input.approvalId)}`) ?? "" }),
      paragraph("Opening this doesn't approve anything. You'll see the full proposal and can approve, change or skip it."),
    ],
    footer: memberFooter({ ...input, because: `${agent} is set to ask you first` }),
  });
}

// ── Dispatch escalation ──────────────────────────────────────────────────────────────────────────

export type EscalationKind = "no_check_in" | "no_show" | "handed_back" | "unfilled";

export function dispatchEscalationEmail(input: Recipient & {
  kind: EscalationKind;
  jobId: string;
  service: string;
  customerName: string;
  area?: string | null;
  startsAt: number;
  cleanerName?: string | null;
  tried: { text: string; state: "done" | "failed" | "open" }[];
  need: string;
}): Email {
  const start = timeOf(input.startsAt, input.timezone);
  const cleaner = input.cleanerName ? oneLine(input.cleanerName) : null;
  const customer = oneLine(input.customerName);
  const headline = {
    no_check_in: `${cleaner ?? "The cleaner"} hasn't checked in for ${customer}`,
    no_show: `${cleaner ?? "The cleaner"} may not show up for ${customer}`,
    handed_back: `Dispatch handed ${customer}'s visit to you`,
    unfilled: `Nobody has taken ${customer}'s visit yet`,
  }[input.kind];
  return finish({
    origin: input.origin,
    subject: `Urgent: ${headline} (${start})`,
    preheader: `${input.need} The visit starts at ${start}.`,
    blocks: [
      agentStatus({ agent: "Dispatch", state: "Needs a person now", tone: "danger", avatarUrl: emailAssets(input.origin).agent("dispatch") }),
      title(headline),
      lead(input.need),
      facts(
        [
          { label: "Visit", value: oneLine(input.service) },
          { label: "Customer", value: customer },
          { label: "Area", value: input.area ?? null },
          { label: "Starts", value: when(input.startsAt, input.timezone) },
          { label: "Cleaner", value: cleaner },
        ],
        "The visit",
      ),
      checklist({ heading: "What Dispatch already did", items: input.tried }),
      action({ label: "Open the visit", url: appLink(input.origin, `/app/schedule?open=job:${encodeURIComponent(input.jobId)}`) ?? "" }),
    ],
    footer: memberFooter({ ...input, because: "urgent operations alerts are on" }),
  });
}

// ── Weekly digest ────────────────────────────────────────────────────────────────────────────────

export function weeklyDigestEmail(input: Recipient & {
  memberName?: string | null;
  weekStart: number;
  weekEnd: number;
  visitsDone: number;
  visitsCancelled: number;
  paidCents: number;
  currency?: string;
  decisionsMade: number;
  waiting: { label: string; detail?: string; path: string }[];
  sections: { heading: string; summary?: string; items: { label: string; detail?: string; path?: string }[]; empty: string }[];
}): Email {
  const company = oneLine(input.companyName);
  const range = `${dayOf(input.weekStart, input.timezone).replace(/, \d{4}$/, "")} – ${dayOf(input.weekEnd, input.timezone)}`;
  const first = firstName(input.memberName);
  const waiting = input.waiting.length;
  const nothing = input.visitsDone === 0 && input.paidCents === 0 && input.decisionsMade === 0 && waiting === 0 && input.sections.every((s) => s.items.length === 0);
  return finish({
    origin: input.origin,
    subject: waiting ? `Your week at ${company}: ${count(waiting, "decision")} waiting` : `Your week at ${company}`,
    preheader: `${count(input.visitsDone, "visit")} done, ${money(input.paidCents, input.currency)} paid in, ${count(input.decisionsMade, "decision")} made.`,
    blocks: [
      eyebrow(`Weekly summary · ${range}`),
      title(first ? `Here's your week, ${first}` : "Here's your week"),
      nothing ? lead("It was a quiet week: nothing was recorded for this company.") : lead(`What happened at ${company}, from your records.`),
      stats([
        { label: "Visits done", value: input.visitsDone.toLocaleString("en-US") },
        { label: "Paid in", value: money(input.paidCents, input.currency) },
        { label: "Decisions made", value: input.decisionsMade.toLocaleString("en-US") },
      ]),
      input.visitsCancelled ? paragraph(`${count(input.visitsCancelled, "visit was", "visits were")} cancelled.`) : { html: "", text: "" },
      digestSection({
        heading: waiting ? `Waiting on you (${waiting})` : "Waiting on you",
        items: input.waiting.map((w) => ({ label: w.label, detail: w.detail, url: appLink(input.origin, w.path) ?? undefined })),
        empty: "Nothing is waiting on you.",
      }),
      ...input.sections.flatMap((s) => [divider(), digestSection({ heading: s.heading, summary: s.summary, items: s.items.map((i) => ({ label: i.label, detail: i.detail, url: i.path ? appLink(input.origin, i.path) ?? undefined : undefined })), empty: s.empty })]),
      action({ label: waiting ? "Review what's waiting" : "Open Selestial", url: appLink(input.origin, waiting ? "/app/approvals" : "/app") ?? "" }),
    ],
    footer: memberFooter({ ...input, because: "the weekly summary is on" }),
  });
}

// ── Payment failure (Selestial plan) ─────────────────────────────────────────────────────────────

export function paymentFailureEmail(input: Recipient & {
  planName: string;
  amountDueCents?: number | null;
  currency?: string;
  failedAt: number;
  cardEnding?: string | null;
  /** When the plan stops if it stays unpaid, as the billing provider reports it. Left out when unknown. */
  pausesAt?: number | null;
}): Email {
  const amount = input.amountDueCents ? money(input.amountDueCents, input.currency) : null;
  return finish({
    origin: input.origin,
    subject: "Your Selestial payment didn't go through",
    preheader: `${amount ? `${amount} for ${oneLine(input.planName)}` : `The payment for ${oneLine(input.planName)}`} was declined. Update your payment method to keep your agents working.`,
    blocks: [
      eyebrow(`Billing · ${oneLine(input.companyName)}`),
      title("Your payment didn't go through"),
      lead(`We couldn't charge ${input.cardEnding ? `the card ending ${input.cardEnding}` : "your payment method"} for your ${oneLine(input.planName)} plan. Nothing has changed yet.`),
      facts([
        { label: "Plan", value: oneLine(input.planName) },
        { label: "Amount due", value: amount },
        { label: "Tried", value: when(input.failedAt, input.timezone) },
        { label: "Card", value: input.cardEnding ? `Ending ${input.cardEnding}` : null },
      ]),
      alert({
        tone: "danger",
        title: input.pausesAt ? `AI work pauses on ${dayOf(input.pausesAt, input.timezone)} if it stays unpaid` : "AI work pauses if it stays unpaid",
        body: "Schedules, records, cleaner links and everything that doesn't use AI keep working either way.",
      }),
      action({ label: "Update payment method", url: appLink(input.origin, "/app/settings/billing") ?? "" }),
    ],
    footer: memberFooter({ ...input, essential: true }),
  });
}

// ── Gmail reconnection ───────────────────────────────────────────────────────────────────────────

export function inboxReconnectEmail(input: Recipient & {
  address: string;
  purposes: string[];
  agents: AgentId[];
  since: number;
  reason: "expired" | "revoked" | "error";
  held: number;
}): Email {
  const address = oneLine(input.address);
  const agents = input.agents.map((a) => AGENT_FACES[a].name);
  const why = { expired: "Google's permission expired", revoked: "access was removed in your Google account", error: "Google stopped answering for it" }[input.reason];
  return finish({
    origin: input.origin,
    subject: `Reconnect ${address} to keep ${listWords(input.purposes) || "your inbox"} running`,
    preheader: `Selestial lost access on ${dayOf(input.since, input.timezone)} because ${why}. Nothing was sent from it since.`,
    blocks: [
      eyebrow(`Connected inbox · ${oneLine(input.companyName)}`),
      title(`${address} needs reconnecting`),
      lead(`Selestial lost access because ${why}. It isn't reading new mail or sending from this inbox until you reconnect it.`),
      facts([
        { label: "Inbox", value: address },
        { label: "Used for", value: listWords(input.purposes) || null },
        { label: "Agents using it", value: listWords(agents) || null },
        { label: "Since", value: when(input.since, input.timezone) },
      ]),
      checklist({
        heading: "While it's disconnected",
        items: [
          { text: input.held ? `${count(input.held, "message is", "messages are")} held. They won't be sent another way.` : "No messages are waiting to go.", state: "open" },
          { text: "New replies stay in Gmail; Selestial will catch up after you reconnect.", state: "open" },
          { text: "Nothing in the inbox was changed or deleted.", state: "done" },
        ],
      }),
      action({ label: "Reconnect Gmail", url: appLink(input.origin, "/app/settings/integrations?tool=gmail") ?? "" }),
      textLink({ before: "Not using it any more?", label: "Disconnect it instead", url: appLink(input.origin, "/app/settings/integrations?tool=gmail") ?? "" }),
    ],
    footer: memberFooter({ ...input, essential: true }),
  });
}

// ── Member invitation ────────────────────────────────────────────────────────────────────────────

const INVITE_ROLE = { manager: "Manager", office: "Office" } as const;

/** The invitation to join a company. The only secret in it is the token inside the link. */
export function memberInvitationEmail(input: { origin?: string | null; companyName: string; inviterName: string; role: "manager" | "office"; url: string; expiresAt: number; timezone?: string }): Email & { subject: string } {
  const company = oneLine(input.companyName);
  const inviter = oneLine(input.inviterName);
  const role = INVITE_ROLE[input.role];
  const until = dayOf(input.expiresAt, input.timezone);
  const invited = `${inviter} invited you to join ${company} on Selestial. Your role will be ${role}.`;
  const { html, text } = renderEmail({
    identity: platform(input.origin),
    preheader: invited,
    blocks: [
      eyebrow("Invitation"),
      title(`Join ${company} on Selestial`),
      lead(invited),
      paragraph("To accept, sign in with the email address this message was sent to."),
      action({ label: "Accept invitation", url: input.url, showAddress: true }),
      paragraph(`This link stops working on ${until}.`),
    ],
    footer: { reason: "If you did not expect this invitation, you can ignore this email. Nothing happens unless you accept." },
  });
  return { subject: `${inviter} invited you to ${company} on Selestial`, preheader: invited, html, text };
}

// ── A short alert ────────────────────────────────────────────────────────────────────────────────

/**
 * A notice that needs no template of its own: credits running out, a customer's payment failing. A
 * heading, what happened, the facts, and the one place to deal with it.
 */
export function alertEmail(input: Recipient & {
  eyebrow: string;
  subject: string;
  heading: string;
  body: string;
  tone: "warning" | "danger" | "info";
  note?: string | null;
  facts?: { label: string; value: string | null }[];
  button: { label: string; path: string };
  essential?: boolean;
  because?: string;
}): Email {
  return finish({
    origin: input.origin,
    subject: input.subject,
    preheader: input.body,
    blocks: [
      eyebrow(`${input.eyebrow} · ${oneLine(input.companyName)}`),
      title(input.heading),
      lead(input.body),
      facts(input.facts ?? []),
      input.note ? alert({ tone: input.tone, title: input.note }) : { html: "", text: "" },
      action({ label: input.button.label, url: appLink(input.origin, input.button.path) ?? "" }),
    ],
    footer: memberFooter({ ...input, essential: input.essential, because: input.because }),
  });
}

// ── An agent acted (Act and notify me) ───────────────────────────────────────────────────────────

export function agentActedEmail(input: Recipient & { agent: AgentId; did: string; at: number; about: { label: string; value: string | null }[]; path: string | null }): Email {
  const agent = AGENT_FACES[input.agent].name;
  return finish({
    origin: input.origin,
    subject: `${agent} did this for you: ${oneLine(input.did)}`,
    preheader: `${agent} acted on its own at ${timeOf(input.at, input.timezone)}, as you allowed. Here's what it did.`,
    blocks: [
      agentStatus({ agent, state: "Done on its own", tone: "success", avatarUrl: emailAssets(input.origin).agent(input.agent) }),
      title(input.did),
      lead(`${agent} did this without asking first, because it's set to Act and notify me for this.`),
      facts([...input.about, { label: "When", value: when(input.at, input.timezone) }]),
      input.path ? action({ label: "See what it did", url: appLink(input.origin, input.path) ?? "" }) : { html: "", text: "" },
      textLink({ before: "Want to be asked first next time?", label: "Change it in Agent controls", url: appLink(input.origin, "/app/settings/agents") ?? "" }),
    ],
    footer: memberFooter({ ...input, because: `${agent} is set to act and notify you` }),
  });
}

// ── Activation: the first work the Owner started ─────────────────────────────────────────────────

/**
 * The first useful result, or the summary once the batch settles. Only what the records show: each
 * output is a real record with its state, each blocker names the one thing that unblocks it. No customer
 * or applicant details are put in the email; the button opens the work behind sign-in.
 */
export function activationEmail(input: Recipient & {
  kind: "first" | "summary";
  agent: AgentId;
  focus: string;
  outputs: { text: string; state: string }[];
  waiting: string[];
  blockers: string[];
  failed: number;
  button: { label: string; path: string };
}): Email {
  const agent = AGENT_FACES[input.agent].name;
  const first = input.kind === "first";
  const subject = first ? `Your first ${agent} ${input.outputs.length === 1 ? "result is" : "assets are"} ready` : input.blockers.length || input.failed ? "Your agents' first work: done, and what's left" : "Your agents finished their first work";
  const done = input.outputs.length;
  const preheader = first
    ? `${agent} prepared ${count(done, "thing")} for ${oneLine(input.companyName)} from what you confirmed. Nothing was published or sent without your permission.`
    : `${count(done, "result")} ready${input.waiting.length ? `, ${count(input.waiting.length, "decision")} for you` : ""}${input.blockers.length ? `, ${count(input.blockers.length, "thing")} blocked` : ""}.`;
  return finish({
    origin: input.origin,
    subject,
    preheader,
    blocks: [
      agentStatus({ agent, state: first ? "First result ready" : "First work settled", tone: input.failed ? "warning" : "success", avatarUrl: emailAssets(input.origin).agent(input.agent) }),
      eyebrow(`${oneLine(input.focus)} · ${oneLine(input.companyName)}`),
      title(first ? subject : "Here's where your agents' first work stands"),
      lead(first ? `Selestial prepared this using the details you confirmed. Drafts stay drafts until you publish them, and nothing reaches a customer, applicant or cleaner except within the permissions you set.` : `Every result below is a record in your workspace that you can open and edit.`),
      checklist({ heading: "Ready now", items: input.outputs.map((o) => ({ text: `${o.text} (${o.state})`, state: "done" as const })) }),
      input.waiting.length ? checklist({ heading: "Waiting on your decision", items: input.waiting.map((text) => ({ text, state: "open" as const })) }) : { html: "", text: "" },
      input.blockers.length ? alert({ tone: "warning", title: input.blockers.length === 1 ? "One thing is blocked" : `${input.blockers.length} things are blocked`, steps: input.blockers }) : { html: "", text: "" },
      input.failed ? paragraph(`${count(input.failed, "task")} could not finish. The details and a retry are on Home.`) : { html: "", text: "" },
      action({ label: input.button.label, url: appLink(input.origin, input.button.path) ?? "" }),
    ],
    footer: memberFooter({ ...input, because: "notices about what your agents did are on" }),
  });
}
