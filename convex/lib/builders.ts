/*
 * The only file that may register a public query, mutation or action. convex/guard.test.ts fails the
 * build if any other file does.
 *
 * The registration casts are a TypeScript limit, not a validator: Convex's builders cannot infer a spread
 * of caller-supplied validators. Each builder states its exact registered type instead, so the generated
 * `api` keeps every argument and return type. The validators still run.
 */
import type { RegisteredMutation, RegisteredQuery, UserIdentity } from "convex/server";
import { v, type ObjectType, type PropertyValidators } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { requireIdentity, requireMember } from "./access";
import { notAllowed, notFound } from "./errors";
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
