/**
 * Inviting a person into a company, and that person accepting.
 *
 * Only the Owner invites. An invitation is an invited members row plus an invitations row that carries
 * the role, the expiry and the state of the email. The person gets a link; the link shows what the
 * invitation is, and joining takes a signed-in person whose verified email is the invited one. The role
 * given is the invitation's. Nothing here takes a role, an email or a company from the person accepting.
 *
 * The link's token is worked out from the deployment's secret each time it is needed. It is in the email
 * and in the answer to `link`, and nowhere else: not in a row, not in an event, not in a log.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { inviteQuery, ownerMutation, ownerQuery, signedInMutation, type MemberAccess } from "./lib/builders";
import { invitationEmail } from "./lib/email/invitation";
import { emailProvider } from "./lib/email/provider";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import {
  appOrigin,
  emailHint,
  invitationExpiry,
  invitationForToken,
  invitationOfMember,
  invitationState,
  invitePath,
  invitesConfigured,
  inviteTokenFor,
  joinByInvitation,
  newPublicId,
  revokeInvitation,
  type InvitationState,
} from "./lib/invitations";
import { allow } from "./lib/rateLimit";
import { grantableRoleValidator } from "./lib/roles";
import { email, text } from "./lib/text";

const MINUTE = 60 * 1000;
/** Invitations made or sent again by one company in an hour. */
export const INVITES_PER_COMPANY_PER_HOUR = 30;
/** Tries at accepting by one signed-in person in ten minutes. */
export const ACCEPTS_PER_USER = 20;
const ACCEPT_WINDOW = 10 * MINUTE;
/** How many times one email is tried when the email service says trying again may work. */
const MAX_SEND_ATTEMPTS = 3;

const LINKS_NOT_SET_UP = "Invitation links aren’t available right now.";
const EMAIL_NOT_CONNECTED = "Email isn’t available right now.";
const NO_APP_ADDRESS = "Invitation links aren’t available right now.";

type GrantableRole = Doc<"invitations">["role"];
type Delivery = Doc<"invitations">["delivery"];
type Queued = "queued" | "not_configured";

/** Refuses once the company has made its hour's worth. Nothing was written, so throwing loses no count. */
async function withinCompanyLimit(ctx: MutationCtx & MemberAccess): Promise<void> {
  if (!(await allow(ctx, `invitations:company:${ctx.companyId}`, INVITES_PER_COMPANY_PER_HOUR, 60 * MINUTE))) {
    throw userError("This company has sent a lot of invitations in the last hour. Try again later.", "limit");
  }
}

/** What to record about the email at the moment an invitation is made or sent again. */
function plannedDelivery(now: number): { delivery: Delivery; answer: Queued } {
  if (emailProvider()) return { delivery: { state: "queued", at: now }, answer: "queued" };
  return { delivery: { state: "not_sent", at: now, problem: EMAIL_NOT_CONNECTED }, answer: "not_configured" };
}

export const create = ownerMutation({
  args: { email: v.string(), name: v.string(), role: grantableRoleValidator },
  handler: async (ctx, args): Promise<{ invitationId: Id<"invitations">; delivery: Queued }> => {
    // Checked before anything is written: an invitation nobody can open is not made.
    if (!invitesConfigured()) throw userError(LINKS_NOT_SET_UP);
    const address = email(args.email);
    const name = text(args.name, "Name", 120);
    const now = Date.now();

    const rows = await ctx.db
      .query("members")
      .withIndex("by_company_email", (q) => q.eq("companyId", ctx.companyId).eq("email", address))
      .take(50);
    if (rows.some((row) => row.status === "active")) throw userError("That person is already in this company.");

    // An invited row whose invitation ran out, or a row whose invitation was revoked before anyone
    // joined, is used again, so one address never has two invitations in one company.
    let seat: Doc<"members"> | null = null;
    let previous: Doc<"invitations"> | null = null;
    for (const row of rows.filter((candidate) => candidate.status === "invited")) {
      const invitation = await invitationOfMember(ctx, row);
      if (invitation && invitationState(invitation, now) === "pending") {
        throw userError("That person has already been invited. Send the invitation again or revoke it instead.");
      }
      if (!seat) [seat, previous] = [row, invitation];
    }
    if (!seat) {
      for (const row of rows.filter((candidate) => candidate.status === "removed" && !candidate.userId)) {
        const invitation = await invitationOfMember(ctx, row);
        if (invitation?.status === "revoked") {
          [seat, previous] = [row, invitation];
          break;
        }
      }
    }
    await withinCompanyLimit(ctx);

    const memberId = seat ? seat._id : await ctx.db.insert("members", { companyId: ctx.companyId, email: address, name, role: args.role, status: "invited", createdAt: now });
    if (seat) await ctx.db.patch(seat._id, { name, role: args.role, status: "invited" });

    const { delivery, answer } = plannedDelivery(now);
    const publicId = newPublicId();
    const fields = { email: address, role: args.role, publicId, status: "pending" as const, expiresAt: invitationExpiry(now), invitedBy: ctx.member._id, createdAt: now, delivery };
    let invitationId: Id<"invitations">;
    if (previous) {
      invitationId = previous._id;
      await ctx.db.patch(previous._id, { ...fields, acceptedAt: undefined, acceptedUserId: undefined, revokedAt: undefined });
    } else {
      invitationId = await ctx.db.insert("invitations", { companyId: ctx.companyId, memberId, ...fields });
    }

    await recordEvent(ctx, { companyId: ctx.companyId, type: "member.invited", actor: byMember(ctx), subject: { table: "members", id: memberId }, data: { role: args.role } });
    if (answer === "queued") await ctx.scheduler.runAfter(0, internal.invitations.deliver, { invitationId, publicId });
    return { invitationId, delivery: answer };
  },
});

export const list = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(200);
    const out: {
      id: Id<"invitations">;
      email: string;
      name: string;
      role: GrantableRole;
      state: InvitationState;
      createdAt: number;
      expiresAt: number;
      acceptedAt?: number;
      delivery: Delivery;
    }[] = [];
    for (const row of rows) {
      const member = await ctx.db.get(row.memberId);
      out.push({
        id: row._id,
        email: row.email,
        name: member?.name ?? row.email,
        role: row.role,
        state: invitationState(row, now),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        ...(row.acceptedAt !== undefined ? { acceptedAt: row.acceptedAt } : {}),
        delivery: row.delivery,
      });
    }
    return out;
  },
});

export const revoke = ownerMutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args): Promise<null> => {
    const invitation = await owned(ctx, args.invitationId);
    if (invitation.status === "accepted") throw userError("That invitation was already accepted. To take the person out of the company, remove them as a member.");
    if (invitation.status === "revoked") return null;
    await revokeInvitation(ctx, invitation, byMember(ctx));
    const seat = await ctx.db.get(invitation.memberId);
    if (seat && seat.status === "invited") await ctx.db.patch(seat._id, { status: "removed" });
    return null;
  },
});

export const reissue = ownerMutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args): Promise<{ delivery: Queued }> => {
    const invitation = await owned(ctx, args.invitationId);
    if (invitation.status === "accepted") throw userError("That invitation was already accepted, so there is no link to send again.");
    if (!invitesConfigured()) throw userError(LINKS_NOT_SET_UP);
    const seat = await ctx.db.get(invitation.memberId);
    if (!seat || seat.companyId !== ctx.companyId) notFound();
    // A revoked invitation comes back only if nobody holds that address in the company by now.
    const sameAddress = await ctx.db
      .query("members")
      .withIndex("by_company_email", (q) => q.eq("companyId", ctx.companyId).eq("email", invitation.email))
      .take(50);
    if (seat.status === "active" || sameAddress.some((row) => row._id !== seat._id && row.status !== "removed")) {
      throw userError("That person is already in this company or has another invitation.");
    }
    await withinCompanyLimit(ctx);

    const now = Date.now();
    const { delivery, answer } = plannedDelivery(now);
    // A new public id is what stops the old link: its signature no longer names anything.
    const publicId = newPublicId();
    if (seat.status !== "invited") await ctx.db.patch(seat._id, { status: "invited" });
    await ctx.db.patch(invitation._id, { publicId, status: "pending", expiresAt: invitationExpiry(now), revokedAt: undefined, delivery });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "invitation.reissued", actor: byMember(ctx), subject: { table: "invitations", id: invitation._id } });
    if (answer === "queued") await ctx.scheduler.runAfter(0, internal.invitations.deliver, { invitationId: invitation._id, publicId });
    return { delivery: answer };
  },
});

/** The link itself, for the Owner to pass on by hand. Recorded as taken; the token is not. */
export const link = ownerMutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args): Promise<{ token: string | null }> => {
    const invitation = await owned(ctx, args.invitationId);
    if (invitationState(invitation, Date.now()) !== "pending") return { token: null };
    const token = await inviteTokenFor(invitation);
    if (token) await recordEvent(ctx, { companyId: ctx.companyId, type: "invitation.link_copied", actor: byMember(ctx), subject: { table: "invitations", id: invitation._id } });
    return { token };
  },
});

type Preview = {
  state: InvitationState | "not_found";
  companyName?: string;
  role?: GrantableRole;
  emailHint?: string;
  expiresAt?: number;
};

/** What a link says to whoever opens it, signed in or not. It shows the invitation and changes nothing. */
export const preview = inviteQuery({
  args: {},
  handler: async (ctx): Promise<Preview> => {
    if (!ctx.invite) return { state: "not_found" };
    const { invitation, company } = ctx.invite;
    return {
      state: invitationState(invitation, Date.now()),
      companyName: company.name,
      role: invitation.role,
      emailHint: emailHint(invitation.email),
      expiresAt: invitation.expiresAt,
    };
  },
});

type Accepted =
  | { status: "joined"; companyId: Id<"companies"> }
  | { status: "already_member"; companyId: Id<"companies"> }
  | { status: "wrong_account"; emailHint: string }
  | { status: "unverified" | "expired" | "revoked" | "used" | "not_found" | "limited" };

export const accept = signedInMutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Accepted> => {
    // Answered, not thrown, so the count of tries is kept.
    if (!(await allow(ctx, `invitations:accept:${ctx.userId}`, ACCEPTS_PER_USER, ACCEPT_WINDOW))) return { status: "limited" };

    const invitation = await invitationForToken(ctx, args.token);
    if (!invitation || !(await ctx.db.get(invitation.companyId))) return { status: "not_found" };
    const companyId = invitation.companyId;
    if (invitation.status === "revoked") return { status: "revoked" };
    if (invitation.status === "accepted") {
      // The same person opening the link again is told what is true now: they are in, or the link is spent.
      if (invitation.acceptedUserId !== ctx.userId) return { status: "used" };
      const mine = await ctx.db
        .query("members")
        .withIndex("by_company_user", (q) => q.eq("companyId", companyId).eq("userId", ctx.userId))
        .take(20);
      return mine.some((row) => row.status === "active") ? { status: "joined", companyId } : { status: "used" };
    }
    if (invitationState(invitation, Date.now()) === "expired") return { status: "expired" };
    if (!ctx.emailVerified || !ctx.email) return { status: "unverified" };
    if (ctx.email !== invitation.email) return { status: "wrong_account", emailHint: emailHint(invitation.email) };

    const joined = await joinByInvitation(ctx, invitation, ctx.userId, ctx.issuer);
    // The invited row is gone, which only happens when the invitation was closed some other way.
    if (!joined) return { status: "revoked" };
    return { status: joined.status, companyId };
  },
});

// ── Sending the email ───────────────────────────────────────────────────────────────────────────

type ToSend =
  | { ready: false; closed: boolean }
  | { ready: true; to: string; companyName: string; inviterName: string; role: GrantableRole; expiresAt: number; timezone: string };

/**
 * What the email for one invitation needs, if it should still go. `publicId` is the link the email was
 * queued for: once the invitation has been sent again it has a new one, and the old email is not sent.
 */
export const forDelivery = internalQuery({
  args: { invitationId: v.id("invitations"), publicId: v.string() },
  handler: async (ctx, args): Promise<ToSend> => {
    const invitation = await ctx.db.get(args.invitationId);
    // Gone, sent again since, or already settled: this email is nobody's to send or to report on.
    if (!invitation || invitation.publicId !== args.publicId || invitation.delivery.state !== "queued") return { ready: false, closed: false };
    const company = await ctx.db.get(invitation.companyId);
    if (!company || invitationState(invitation, Date.now()) !== "pending") return { ready: false, closed: true };
    const inviter = await ctx.db.get(invitation.invitedBy);
    return {
      ready: true,
      to: invitation.email,
      companyName: company.name,
      inviterName: inviter?.name ?? "The owner",
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      timezone: company.timezone,
    };
  },
});

const outcomeValidator = v.union(
  v.object({ kind: v.literal("sent") }),
  v.object({ kind: v.literal("failed"), retryable: v.boolean(), problem: v.string() }),
  v.object({ kind: v.literal("not_sent"), problem: v.string() }),
);
type Outcome = typeof outcomeValidator.type;

/** Writes down what became of one email. An answer about a link that has since been replaced changes nothing. */
export const settle = internalMutation({
  args: { invitationId: v.id("invitations"), publicId: v.string(), attempt: v.number(), outcome: outcomeValidator },
  handler: async (ctx, args): Promise<null> => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.publicId !== args.publicId || invitation.delivery.state !== "queued") return null;
    const now = Date.now();
    const subject = { table: "invitations" as const, id: invitation._id };
    const outcome = args.outcome;
    if (outcome.kind === "sent") {
      await ctx.db.patch(invitation._id, { delivery: { state: "sent", at: now } });
      await recordEvent(ctx, { companyId: invitation.companyId, type: "invitation.email_sent", actor: { kind: "system" }, subject, data: { attempt: args.attempt } });
      return null;
    }
    if (outcome.kind === "not_sent") {
      await ctx.db.patch(invitation._id, { delivery: { state: "not_sent", at: now, problem: outcome.problem } });
      return null;
    }
    if (outcome.retryable && args.attempt < MAX_SEND_ATTEMPTS) {
      await ctx.db.patch(invitation._id, { delivery: { state: "queued", at: invitation.delivery.at, problem: outcome.problem } });
      await ctx.scheduler.runAfter(args.attempt * 30_000, internal.invitations.deliver, { invitationId: invitation._id, publicId: args.publicId, attempt: args.attempt + 1 });
      return null;
    }
    await ctx.db.patch(invitation._id, { delivery: { state: "failed", at: now, problem: outcome.problem } });
    await recordEvent(ctx, { companyId: invitation.companyId, type: "invitation.email_failed", actor: { kind: "system" }, subject, data: { attempts: args.attempt } });
    return null;
  },
});

export const deliver = internalAction({
  args: { invitationId: v.id("invitations"), publicId: v.string(), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 1;
    const record = async (outcome: Outcome): Promise<null> => {
      await ctx.runMutation(internal.invitations.settle, { invitationId: args.invitationId, publicId: args.publicId, attempt, outcome });
      return null;
    };
    const found: ToSend = await ctx.runQuery(internal.invitations.forDelivery, { invitationId: args.invitationId, publicId: args.publicId });
    if (!found.ready) return found.closed ? record({ kind: "not_sent", problem: "The invitation was closed before the email went out." }) : null;

    const origin = appOrigin();
    if (!origin) return record({ kind: "not_sent", problem: NO_APP_ADDRESS });
    const token = await inviteTokenFor({ publicId: args.publicId });
    if (!token) return record({ kind: "not_sent", problem: LINKS_NOT_SET_UP });
    const provider = emailProvider();
    if (!provider) return record({ kind: "not_sent", problem: EMAIL_NOT_CONNECTED });

    const message = invitationEmail({ companyName: found.companyName, inviterName: found.inviterName, role: found.role, url: `${origin}${invitePath(token)}`, expiresAt: found.expiresAt, timezone: found.timezone });
    let outcome: Outcome;
    try {
      // The key names this one link's email, so the provider drops a repeat instead of sending it twice.
      const result = await provider.send({ to: found.to, ...message, idempotencyKey: `invitation-${args.invitationId}-${args.publicId}` });
      outcome = result.ok ? { kind: "sent" } : { kind: "failed", retryable: result.retryable, problem: result.problem };
    } catch {
      // Nothing about the error is kept: it could carry the address, the link or the provider's words.
      outcome = { kind: "failed", retryable: false, problem: "The email service did not answer, so it is not known whether the email went." };
    }
    return record(outcome);
  },
});
