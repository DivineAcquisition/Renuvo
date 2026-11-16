/*
 * The only file that may register a public query, mutation or action. convex/guard.test.ts fails the
 * build if any other file does.
 *
 * The registration casts are a TypeScript limit, not a validator: Convex's builders cannot infer a spread
 * of caller-supplied validators. Each builder states its exact registered type instead, so the generated
 * `api` keeps every argument and return type. The validators still run.
 */
import type { PublicHttpAction, RegisteredMutation, RegisteredQuery, UserIdentity } from "convex/server";
import { v, type ObjectType, type PropertyValidators } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { httpAction, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { requireIdentity, requireMember } from "./access";
import { linkForToken, linkState, noteLinkAction, type LinkAction, type LinkState } from "./dispatch/links";
import { notAllowed, notFound, userError } from "./errors";
import { applicantLinkForToken, applicantLinkState, noteApplicantAction, type ApplicantAction, type ApplicantLinkPurpose } from "./recruiter/links";
import { invitationForToken } from "./invitations";
import { isManager, isOwner, roleOf, type Role } from "./roles";

type AnyValidators = Record<string, PropertyValidators[string]>;

/** The arguments a company function takes from callers: its own, plus the company. */
export type CompanyArgs<V extends AnyValidators> = ObjectType<V> & { companyId: Id<"companies"> };

export type MemberAccess = {
  identity: UserIdentity;
  member: Doc<"members">;
  company: Doc<"companies">;
  companyId: Id<"companies">;
  role: Role;
};

type QueryDef<V extends AnyValidators, R> = {
  args: V;
  handler: (ctx: QueryCtx & MemberAccess, args: ObjectType<V>) => R;
};
type MutationDef<V extends AnyValidators, R> = {
  args: V;
  handler: (ctx: MutationCtx & MemberAccess, args: ObjectType<V>) => R;
};

/** A read inside a company. Any active member. */
export function companyQuery<V extends AnyValidators, R>(def: QueryDef<V, R>): RegisteredQuery<"public", CompanyArgs<V>, R> {
  return query({
    args: { companyId: v.id("companies"), ...def.args },
    handler: async (ctx: QueryCtx, args: { companyId: Id<"companies"> }) => {
      const { companyId, ...rest } = args;
      const access = await requireMember(ctx, companyId);
      return def.handler({ ...ctx, ...access, role: roleOf(access.member.role) }, rest as ObjectType<V>);
    },
  } as any) as RegisteredQuery<"public", CompanyArgs<V>, R>;
}

/** A write inside a company. Any active member: Office works the queue, so day-to-day records are theirs too. */
export function companyMutation<V extends AnyValidators, R>(def: MutationDef<V, R>): RegisteredMutation<"public", CompanyArgs<V>, R> {
  return mutation({
    args: { companyId: v.id("companies"), ...def.args },
    handler: async (ctx: MutationCtx, args: { companyId: Id<"companies"> }) => {
      const { companyId, ...rest } = args;
      const access = await requireMember(ctx, companyId);
      return def.handler({ ...ctx, ...access, role: roleOf(access.member.role) }, rest as ObjectType<V>);
    },
  } as any) as RegisteredMutation<"public", CompanyArgs<V>, R>;
}

/** Operations and approvals: Owners and Managers. */
export function managerQuery<V extends AnyValidators, R>(def: QueryDef<V, R>) {
  return companyQuery({
    args: def.args,
    handler: async (ctx, args) => {
      if (!isManager(ctx.role)) notAllowed();
      return def.handler(ctx, args);
    },
  });
}

export function managerMutation<V extends AnyValidators, R>(def: MutationDef<V, R>) {
  return companyMutation({
    args: def.args,
    handler: async (ctx, args) => {
      if (!isManager(ctx.role)) notAllowed();
      return def.handler(ctx, args);
    },
  });
}

/** A read only the Owner makes: who has been invited, and what became of each invitation. */
export function ownerQuery<V extends AnyValidators, R>(def: QueryDef<V, R>) {
  return companyQuery({
    args: def.args,
    handler: async (ctx, args) => {
      if (!isOwner(ctx.role)) notAllowed();
      return def.handler(ctx, args);
    },
  });
}

/** Authority settings, pay, people and the company itself: the Owner only. */
export function ownerMutation<V extends AnyValidators, R>(def: MutationDef<V, R>) {
  return companyMutation({
    args: def.args,
    handler: async (ctx, args) => {
      if (!isOwner(ctx.role)) notAllowed();
      return def.handler(ctx, args);
    },
  });
}

export type SignedIn = { userId: string; email: string; emailVerified: boolean; name: string };

function signedIn(identity: UserIdentity): SignedIn {
  return {
    userId: identity.subject,
    email: identity.email?.trim().toLowerCase() ?? "",
    emailVerified: identity.emailVerified === true,
    name: identity.name?.trim() || identity.email?.trim() || "Member",
  };
}

/** For a signed-in person who is not inside a company yet: creating one, or finding the ones they belong to. */
export function signedInQuery<V extends AnyValidators, R>(def: {
  args: V;
  handler: (ctx: QueryCtx & SignedIn, args: ObjectType<V>) => R;
}): RegisteredQuery<"public", ObjectType<V>, R> {
  return query({
    args: def.args,
    handler: async (ctx: QueryCtx, args: ObjectType<V>) => def.handler({ ...ctx, ...signedIn(await requireIdentity(ctx)) }, args),
  } as any);
}

export function signedInMutation<V extends AnyValidators, R>(def: {
  args: V;
  handler: (ctx: MutationCtx & SignedIn, args: ObjectType<V>) => R;
}): RegisteredMutation<"public", ObjectType<V>, R> {
  return mutation({
    args: def.args,
    handler: async (ctx: MutationCtx, args: ObjectType<V>) => def.handler({ ...ctx, ...signedIn(await requireIdentity(ctx)) }, args),
  } as any);
}

// ── Selestial staff: the people who run Selestial, not members of a cleaning company ─────────────

export type StaffAccess = SignedIn & { staff: Doc<"staff"> };

/**
 * The signed-in person's staff record, or null. A person is staff only with a confirmed email that
 * matches an active staff row. The very first admin can be named by STAFF_BOOTSTRAP_EMAIL on the
 * deployment; that setting matters only while the staff table has no active admin.
 */
export async function staffFor(ctx: QueryCtx, who: SignedIn): Promise<Doc<"staff"> | "bootstrap" | null> {
  if (!who.emailVerified || !who.email) return null;
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_email", (q) => q.eq("email", who.email))
    .take(5);
  const row = rows.find((item) => item.status === "active");
  if (row) return row.userId && row.userId !== who.userId ? null : row;
  const bootstrap = process.env.STAFF_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (!bootstrap || bootstrap !== who.email) return null;
  const anyAdmin = await ctx.db.query("staff").take(50);
  return anyAdmin.some((item) => item.status === "active" && item.role === "admin") ? null : "bootstrap";
}

async function requireStaff(ctx: MutationCtx | QueryCtx, who: SignedIn, writable: boolean): Promise<Doc<"staff">> {
  const found = await staffFor(ctx, who);
  if (!found) notFound();
  if (found !== "bootstrap") {
    if (writable && !found.userId) await (ctx as MutationCtx).db.patch(found._id, { userId: who.userId });
    return found;
  }
  if (!writable) {
    // A read before the first write: answer as an admin that has not been saved yet.
    return { _id: "bootstrap" as Id<"staff">, _creationTime: 0, email: who.email, name: who.name, role: "admin", status: "active", addedAt: 0, addedBy: "bootstrap", userId: who.userId };
  }
  const id = await (ctx as MutationCtx).db.insert("staff", { userId: who.userId, email: who.email, name: who.name, role: "admin", status: "active", addedAt: Date.now(), addedBy: "bootstrap" });
  return (await ctx.db.get(id))!;
}

/** For Selestial staff only. Anyone else, signed in or not, gets "Not found.", as if the function did not exist. */
export function staffQuery<V extends AnyValidators, R>(def: { args: V; handler: (ctx: QueryCtx & StaffAccess, args: ObjectType<V>) => R }): RegisteredQuery<"public", ObjectType<V>, R> {
  return query({
    args: def.args,
    handler: async (ctx: QueryCtx, args: ObjectType<V>) => {
      const who = signedIn(await requireIdentity(ctx));
      const staff = await requireStaff(ctx, who, false);
      return def.handler({ ...ctx, ...who, staff }, args);
    },
  } as any);
}

/** For Selestial staff only. `adminOnly` limits it to staff admins. */
export function staffMutation<V extends AnyValidators, R>(def: { args: V; adminOnly?: boolean; handler: (ctx: MutationCtx & StaffAccess, args: ObjectType<V>) => R }): RegisteredMutation<"public", ObjectType<V>, R> {
  return mutation({
    args: def.args,
    handler: async (ctx: MutationCtx, args: ObjectType<V>) => {
      const who = signedIn(await requireIdentity(ctx));
      const staff = await requireStaff(ctx, who, true);
      if (def.adminOnly && staff.role !== "admin") notAllowed();
      return def.handler({ ...ctx, ...who, staff }, args);
    },
  } as any);
}

// ── Public reads: anyone, signed in or not ─────────────────────────────────────────────────────────

/**
 * A read anyone may make, with no sign-in, no token and no secret. The handler is given no identity, so
 * it cannot answer differently for different callers. It must return only what is already meant for
 * the public (for example the trust snapshot, built by `publicView`), never a company record, a request,
 * a note or a staff name. convex/lib/guard.ts allows it only in the files listed in PUBLIC_QUERY_FILES.
 */
export function publicQuery<V extends AnyValidators, R>(def: { args: V; handler: (ctx: QueryCtx, args: ObjectType<V>) => R }): RegisteredQuery<"public", ObjectType<V>, R> {
  return query({
    args: def.args,
    handler: async (ctx: QueryCtx, args: ObjectType<V>) => def.handler(ctx, args),
  } as any);
}

function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Called only by the Selestial web server, which holds PUBLIC_FORM_SECRET. A caller without the matching
 * secret gets the same "Not found." as a missing function. With no secret set on the deployment, it is closed.
 */
export function serverMutation<V extends AnyValidators, R>(def: {
  args: V;
  handler: (ctx: MutationCtx, args: ObjectType<V>) => R;
}): RegisteredMutation<"public", ObjectType<V> & { secret: string }, R> {
  return mutation({
    args: { secret: v.string(), ...def.args },
    handler: async (ctx: MutationCtx, args: { secret: string }) => {
      const expected = process.env.PUBLIC_FORM_SECRET?.trim();
      if (!expected || !sameSecret(args.secret, expected)) notFound();
      const rest: Record<string, unknown> = { ...args };
      delete rest.secret;
      return def.handler(ctx, rest as ObjectType<V>);
    },
  } as any);
}

// ── Invitation links: what a link says before the person holding it has signed in ───────────────

export type InviteAccess = {
  /** The invitation the token names and its company, or null when the token names nothing. */
  invite: { invitation: Doc<"invitations">; company: Doc<"companies"> } | null;
};

/**
 * A read through an invitation link, by someone who has not signed in. The token is the only thing
 * trusted: no id in the arguments is, and everything the handler shows must hang off `ctx.invite`. A
 * wrong signature, an unknown id, a malformed token and a deployment with no secret all arrive as null,
 * so the handler cannot tell them apart and neither can the caller. It is a query, so opening a link
 * (or a mail program previewing it) changes nothing. Joining is a separate, signed-in step.
 */
export function inviteQuery<V extends AnyValidators, R>(def: {
  args: V;
  handler: (ctx: QueryCtx & InviteAccess, args: ObjectType<V>) => R;
}): RegisteredQuery<"public", ObjectType<V> & { token: string }, R> {
  return query({
    args: { token: v.string(), ...def.args },
    handler: async (ctx: QueryCtx, args: { token: string }) => {
      const { token, ...rest } = args;
      const invitation = await invitationForToken(ctx, token);
      const company = invitation ? await ctx.db.get(invitation.companyId) : null;
      return def.handler({ ...ctx, invite: invitation && company ? { invitation, company } : null }, rest as ObjectType<V>);
    },
  } as any);
}

// ── Action links: a cleaner acting on one assignment without signing in ─────────────────────────

export type LinkAccess = {
  link: Doc<"actionLinks">;
  linkState: LinkState;
  company: Doc<"companies">;
  companyId: Id<"companies">;
};

async function linkAccess(ctx: QueryCtx | MutationCtx, token: string): Promise<LinkAccess> {
  const link = await linkForToken(ctx, token);
  const company = link ? await ctx.db.get(link.companyId) : null;
  // A token that names nothing gets the same "Not found." whatever was wrong with it.
  if (!link || !company) notFound();
  return { link, linkState: linkState(link, Date.now()), company, companyId: link.companyId };
}

/**
 * A read through an action link. The token is the only authorization: no id in the arguments is trusted,
 * and everything the handler reads must hang off `ctx.link`. A read never changes anything, so opening a
 * link (or a phone previewing it) does nothing. The handler is given the link even when it is expired
 * or revoked, so the page can say so; it decides what such a link may still see.
 */
export function linkQuery<V extends AnyValidators, R>(def: {
  args: V;
  handler: (ctx: QueryCtx & LinkAccess, args: ObjectType<V>) => R;
}): RegisteredQuery<"public", ObjectType<V> & { token: string }, R> {
  return query({
    args: { token: v.string(), ...def.args },
    handler: async (ctx: QueryCtx, args: { token: string }) => {
      const { token, ...rest } = args;
      return def.handler({ ...ctx, ...(await linkAccess(ctx, token)) }, rest as ObjectType<V>);
    },
  } as any);
}

const CLOSED_WORDS: Record<Exclude<LinkState, "active">, string> = {
  expired: "This link has expired.",
  revoked: "This link is no longer active.",
};

/**
 * One named action through an action link. Refused unless the link is active right now and lists the
 * action. The handler must still check the assignment itself: a link says who may ask, the record says
 * whether it can be done. Every action carried out is recorded against the link.
 */
export function linkMutation<V extends AnyValidators, R>(def: {
  action: LinkAction;
  args: V;
  handler: (ctx: MutationCtx & LinkAccess, args: ObjectType<V>) => R;
}): RegisteredMutation<"public", ObjectType<V> & { token: string }, R> {
  return mutation({
    args: { token: v.string(), ...def.args },
    handler: async (ctx: MutationCtx, args: { token: string }) => {
      const { token, ...rest } = args;
      const access = await linkAccess(ctx, token);
      if (access.linkState !== "active") throw userError(CLOSED_WORDS[access.linkState], "not_allowed");
      if (!access.link.allowed.includes(def.action)) notAllowed();
      const result = await def.handler({ ...ctx, ...access }, rest as ObjectType<V>);
      await noteLinkAction(ctx, access.link, def.action);
      return result;
    },
  } as any);
}

// ── Applicant links: an applicant acting on one application without signing in ───────────────────

export type ApplicantAccess = {
  link: Doc<"applicantLinks">;
  linkState: LinkState;
  company: Doc<"companies">;
  companyId: Id<"companies">;
  application: Doc<"applications">;
  applicant: Doc<"applicants">;
};

async function applicantAccess(ctx: QueryCtx | MutationCtx, token: string, purpose: ApplicantLinkPurpose): Promise<ApplicantAccess> {
  const link = await applicantLinkForToken(ctx, token);
  const company = link ? await ctx.db.get(link.companyId) : null;
  const application = link ? await ctx.db.get(link.applicationId) : null;
  const applicant = link ? await ctx.db.get(link.applicantId) : null;
  // A token for another kind of page, or one whose records left its company, names nothing.
  if (!link || !company || !application || !applicant || link.purpose !== purpose) notFound();
  if (application.companyId !== link.companyId || applicant.companyId !== link.companyId || application.applicantId !== applicant._id) notFound();
  return { link, linkState: applicantLinkState(link, Date.now()), company, companyId: link.companyId, application, applicant };
}

/**
 * A read through an applicant link. The token is the only authorization, and the handler is given the
 * link's own application and applicant and nothing else. A read changes nothing, so opening a link (or a
 * mail scanner following it) submits nothing and accepts nothing.
 */
export function applicantQuery<V extends AnyValidators, R>(def: {
  purpose: ApplicantLinkPurpose;
  args: V;
  handler: (ctx: QueryCtx & ApplicantAccess, args: ObjectType<V>) => R;
}): RegisteredQuery<"public", ObjectType<V> & { token: string }, R> {
  return query({
    args: { token: v.string(), ...def.args },
    handler: async (ctx: QueryCtx, args: { token: string }) => {
      const { token, ...rest } = args;
      return def.handler({ ...ctx, ...(await applicantAccess(ctx, token, def.purpose)) }, rest as ObjectType<V>);
    },
  } as any);
}

/** One named action through an applicant link. Refused unless the link is active and lists the action. */
export function applicantMutation<V extends AnyValidators, R>(def: {
  purpose: ApplicantLinkPurpose;
  action: ApplicantAction;
  args: V;
  handler: (ctx: MutationCtx & ApplicantAccess, args: ObjectType<V>) => R;
}): RegisteredMutation<"public", ObjectType<V> & { token: string }, R> {
  return mutation({
    args: { token: v.string(), ...def.args },
    handler: async (ctx: MutationCtx, args: { token: string }) => {
      const { token, ...rest } = args;
      const access = await applicantAccess(ctx, token, def.purpose);
      if (access.linkState !== "active") throw userError(CLOSED_WORDS[access.linkState], "not_allowed");
      if (!access.link.allowed.includes(def.action)) notAllowed();
      const result = await def.handler({ ...ctx, ...access }, rest as ObjectType<V>);
      await noteApplicantAction(ctx, access.link, def.action);
      return result;
    },
  } as any);
}

// ── Provider webhooks: a delivery service telling us what happened to a message ──────────────────

/**
 * An HTTP endpoint for one provider's webhook. The handler receives the raw body only after `verify`
 * has accepted it; anything else gets a bare 401 and nothing is read. A webhook can never reach a
 * company's records except through the internal function the handler calls.
 */
export function providerWebhook(def: {
  verify: (request: Request, body: string) => Promise<boolean>;
  handler: (ctx: ActionCtx, body: string, request: Request) => Promise<void>;
}): PublicHttpAction {
  return httpAction(async (ctx, request) => {
    const body = await request.text();
    if (body.length > 256 * 1024 || !(await def.verify(request, body))) return new Response(null, { status: 401 });
    await def.handler(ctx, body, request);
    return new Response(null, { status: 200 });
  });
}

/**
 * A GET endpoint a provider sends a person's browser back to after they agreed to something (OAuth).
 * The handler gets only the query parameters and answers with a redirect; it carries no session and must
 * prove who started the request from the state it was given.
 */
export function oauthCallback(def: { handler: (ctx: ActionCtx, params: URLSearchParams) => Promise<string> }): PublicHttpAction {
  return httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const location = await def.handler(ctx, params);
    return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  });
}

/**
 * A GET for a stored file, served only for a request whose address the deployment signed and that has
 * not expired. `verify` decides; anything it refuses is a plain 404, so a wrong id, a wrong signature
 * and an expired address cannot be told apart.
 */
export function signedFileRoute(def: { verify: (request: Request, now: number) => Promise<boolean>; handler: (ctx: ActionCtx, request: Request, now: number) => Promise<Response | null> }): PublicHttpAction {
  return httpAction(async (ctx, request) => {
    const now = Date.now();
    if (!(await def.verify(request, now))) return new Response("Not found.", { status: 404 });
    return (await def.handler(ctx, request, now)) ?? new Response("Not found.", { status: 404 });
  });
}
