/**
 * The server side of an Admin Support Session (docs/operations/03-support-sessions.md). Every company
 * function that is called with a `supportSessionId` comes through here instead of the membership check:
 *
 *  - the caller must be an active staff member with `workspace.view`, signed in as themselves;
 *  - the session must be theirs, for this company, not ended and not expired;
 *  - reads see what the session's preview role sees, with customer message content hidden unless it was
 *    revealed with a reason;
 *  - writes need Manage mode, a function that is open to support sessions, the capability it names, and a
 *    Manage basis that still holds (the owner's grant, or an open incident for this company).
 *
 * The work is done as the company's "Selestial Support" member, so every record and event says Selestial
 * Support did it, never the owner. The session records which staff member that was.
 */
import type { UserIdentity } from "convex/server";

import type { Doc, Id, TableNames } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { maskAddress } from "../cleaners/portal";
import { notFound, userError } from "../errors";
import { capabilitiesOf, HIDDEN_WORDS, RECENT_VERIFICATION_MINUTES, REDACTED_FIELDS, SUPPORT_EMAIL, SUPPORT_NAME, type Capability } from "./catalog";

type Ctx = QueryCtx | MutationCtx;

export type SupportContext = {
  session: Doc<"supportSessions">;
  staff: Doc<"staff">;
  capabilities: Set<Capability>;
  /** Customer message content is shown: a reveal with a reason is still in effect. */
  revealed: boolean;
};

/** What a function opened to support sessions declares: the capability it needs and what the owner is told it did. */
export type SupportUse = { capability: Capability; summary: string };

/** Support sessions are off unless the deployment turns them on, once the privacy notice discloses them. */
export function supportEnabled(): boolean {
  return process.env.SUPPORT_ACCESS?.trim() === "on";
}

/** The staff row of the person signed in, active, matched by their sign-in and confirmed email. */
export async function activeStaff(ctx: Ctx, identity: UserIdentity): Promise<Doc<"staff"> | null> {
  if (identity.emailVerified !== true) return null;
  const row = await ctx.db
    .query("staff")
    .withIndex("by_user", (q) => q.eq("userId", identity.subject))
    .first();
  if (!row || row.status !== "active") return null;
  if (row.email !== identity.email?.trim().toLowerCase()) return null;
  return row;
}

/**
 * Minutes since the second factor was last confirmed, from the sign-in token's `fva` claim
 * ([first factor, second factor], -1 for never). Null when the token does not carry it.
 */
export function secondFactorAge(identity: UserIdentity): number | null {
  let fva: unknown = (identity as unknown as Record<string, unknown>).fva;
  if (typeof fva === "string") {
    try {
      fva = JSON.parse(fva);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(fva) || fva.length < 2) return null;
  const second = Number(fva[1]);
  return Number.isFinite(second) ? second : null;
}

/** Starting a session, switching to Manage, extending and revealing all need a second factor confirmed in the last ten minutes. */
export function requireRecentVerification(identity: UserIdentity) {
  const age = secondFactorAge(identity);
  if (age === null) throw userError("Your sign-in doesn't say when you last used your second factor, so support access can't start. See docs/operations/03-support-sessions.md.", "not_allowed");
  if (age < 0) throw userError("Support access needs two-step verification. Turn it on in your account security settings first.", "not_allowed");
  if (age > RECENT_VERIFICATION_MINUTES) throw userError(`Confirm it's you with your second factor (last confirmed ${age} minutes ago).`, "not_allowed");
}

/** The company's Selestial Support member, made once. It cannot sign in and is never sent a notice. */
export async function ensureSupportMember(ctx: MutationCtx, companyId: Id<"companies">): Promise<Doc<"members">> {
  const found = await supportMember(ctx, companyId);
  if (found) return found;
  const id = await ctx.db.insert("members", { companyId, email: SUPPORT_EMAIL, name: SUPPORT_NAME, role: "office", status: "support", createdAt: Date.now() });
  return (await ctx.db.get(id))!;
}

export async function supportMember(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"members"> | null> {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_company_email", (q) => q.eq("companyId", companyId).eq("email", SUPPORT_EMAIL))
    .take(5);
  return rows.find((row) => row.status === "support") ?? null;
}

/** A session that is still open: not ended, not past its time. Anything else is refused. */
export function sessionOpen(session: Doc<"supportSessions">, now: number): boolean {
  return session.endedAt === undefined && session.expiresAt > now;
}

/** The checks every call in a support session passes. Returns what the company function runs as. */
export async function requireSupport(ctx: Ctx, companyId: Id<"companies">, sessionId: Id<"supportSessions">) {
  if (!supportEnabled()) notFound();
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) notFound();
  const staff = await activeStaff(ctx, identity);
  if (!staff) notFound();
  const session = await ctx.db.get(sessionId);
  // Another staff member's session, or this session used for another company, is "Not found." like any other.
  if (!session || session.staffId !== staff._id || session.companyId !== companyId) notFound();
  const now = Date.now();
  if (!sessionOpen(session, now)) throw userError("This support session has ended. Start a new one from the staff console.", "not_allowed");
  const capabilities = capabilitiesOf(staff);
  if (!capabilities.has("workspace.view")) notFound();
  const company = await ctx.db.get(companyId);
  const member = await supportMember(ctx, companyId);
  if (!company || !member) notFound();
  const support: SupportContext = { session, staff, capabilities, revealed: (session.revealedUntil ?? 0) > now };
  return { identity, member, company, companyId, support };
}

/** A Manage session still has what allowed it: the owner's grant in force, or an open incident for this company. */
export async function manageBasisHolds(ctx: Ctx, session: Doc<"supportSessions">, now: number): Promise<boolean> {
  const manage = session.manage;
  if (!manage) return false;
  if (manage.basis === "owner_grant") {
    const grant = manage.grantId ? await ctx.db.get(manage.grantId) : null;
    return Boolean(grant && grant.companyId === session.companyId && !grant.revokedAt && grant.expiresAt > now);
  }
  const incident = manage.incidentId ? await ctx.db.get(manage.incidentId) : null;
  return Boolean(incident && incident.companyId === session.companyId && incident.resolvedAt === 0);
}

/** The owner's grant in force for this company, if any. */
export async function activeGrant(ctx: Ctx, companyId: Id<"companies">, now: number): Promise<Doc<"supportGrants"> | null> {
  const rows = await ctx.db
    .query("supportGrants")
    .withIndex("by_company_granted", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(10);
  return rows.find((row) => !row.revokedAt && row.expiresAt > now) ?? null;
}

/** An open incident for this company that can justify Manage: the session's own, or the most recent one. */
export async function openIncidentFor(ctx: Ctx, companyId: Id<"companies">, preferred?: Id<"incidents">): Promise<Doc<"incidents"> | null> {
  if (preferred) {
    const incident = await ctx.db.get(preferred);
    if (incident && incident.companyId === companyId && incident.resolvedAt === 0) return incident;
  }
  return ctx.db
    .query("incidents")
    .withIndex("by_company_resolved", (q) => q.eq("companyId", companyId).eq("resolvedAt", 0))
    .order("desc")
    .first();
}

/** One change made in a session, recorded with the change itself: if the change fails, so does this. */
export async function recordSupportChange(ctx: MutationCtx, support: SupportContext, use: SupportUse, fields: string[]) {
  await ctx.db.insert("supportEvents", { sessionId: support.session._id, companyId: support.session.companyId, staffId: support.staff._id, kind: "change", summary: use.summary, fields: fields.filter((name) => name !== "companyId").slice(0, 30), at: Date.now() });
  const fresh = await ctx.db.get(support.session._id);
  if (fresh) await ctx.db.patch(fresh._id, { changes: fresh.changes + 1 });
}

// ── Hiding customer words from support reads ─────────────────────────────────────────────────────

const REDACTED_TABLES = Object.keys(REDACTED_FIELDS) as TableNames[];

function redactDoc(table: string | null, doc: unknown): unknown {
  if (!table || !doc || typeof doc !== "object" || !("_id" in doc)) return doc;
  const rule = REDACTED_FIELDS[table];
  if (!rule) return doc;
  const out: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
  for (const field of rule.hide) if (typeof out[field] === "string" && out[field] !== "") out[field] = HIDDEN_WORDS;
  for (const field of rule.mask ?? []) {
    const value = out[field];
    if (typeof value === "string" && value) out[field] = maskAddress(value.includes("@") ? "email" : "sms", value);
  }
  return out;
}

function redactResult(table: string | null, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((row) => redactDoc(table, row));
  if (value && typeof value === "object" && "page" in value && Array.isArray((value as { page: unknown[] }).page)) {
    return { ...(value as object), page: (value as { page: unknown[] }).page.map((row) => redactDoc(table, row)) };
  }
  return redactDoc(table, value);
}

/** A query chain whose results come back with the table's customer words hidden. */
function wrapChain<T extends object>(target: T, table: string): T {
  return new Proxy(target, {
    get(inner, prop) {
      if (prop === Symbol.asyncIterator) {
        return () => {
          const iterator = (inner as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
          return {
            async next() {
              const step = await iterator.next();
              return step.done ? step : { done: false, value: redactDoc(table, step.value) };
            },
            [Symbol.asyncIterator]() {
              return this;
            },
          };
        };
      }
      const value = Reflect.get(inner, prop, inner);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(inner, args);
        if (out && typeof (out as Promise<unknown>).then === "function") return (out as Promise<unknown>).then((result) => redactResult(table, result));
        if (out && typeof out === "object") return wrapChain(out as object, table);
        return out;
      };
    },
  });
}

/**
 * The database as a support read sees it. Only queries use this; a mutation in a support session sees
 * the stored values, so nothing hidden here can ever be written back.
 */
export function redactingDb<D extends QueryCtx["db"]>(db: D): D {
  const tableOf = (id: unknown): string | null => {
    if (typeof id !== "string") return null;
    for (const table of REDACTED_TABLES) if (db.normalizeId(table, id)) return table;
    return null;
  };
  return new Proxy(db, {
    get(inner, prop) {
      const value = Reflect.get(inner, prop, inner);
      if (prop === "get") {
        return async (...args: unknown[]) => {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(inner, args);
          // db.get(id) or db.get(table, id).
          const table = args.length > 1 && typeof args[0] === "string" && REDACTED_FIELDS[args[0]] ? args[0] : tableOf(args[args.length - 1]);
          return redactDoc(table, result);
        };
      }
      if (prop === "query") {
        return (table: string) => {
          const chain = (value as (t: string) => object).call(inner, table);
          return REDACTED_FIELDS[table] ? wrapChain(chain, table) : chain;
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(inner) : value;
    },
  });
}
