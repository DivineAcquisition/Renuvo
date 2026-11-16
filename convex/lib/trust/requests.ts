/**
 * Saving a trust request and planning the email about it. Shared by the public form
 * (convex/requests.ts) and a company Owner asking for their company to be deleted (convex/dataRights.ts).
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { emailProvider } from "../email/provider";
import type { RequestKind } from "./schema";

// ── References and keys ───────────────────────────────────────────────────────────────────────────

/** No 0/O, 1/I/L: a reference is read out over the phone and typed back. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomReference(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `SR-${out.slice(0, 5)}-${out.slice(5)}`;
}

async function newReference(ctx: MutationCtx): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const reference = randomReference();
    const taken = await ctx.db
      .query("trustRequests")
      .withIndex("by_reference", (q) => q.eq("reference", reference))
      .first();
    if (!taken) return reference;
  }
  throw new Error("Could not choose a free reference.");
}

// ── Who is told ───────────────────────────────────────────────────────────────────────────────────

type NotifyPlan = { state: "pending" } | { state: "not_configured"; problem: string };

/** The inbox for a kind of request, only when staff have marked that address verified. */
export async function inboxFor(ctx: { db: QueryCtx["db"] | MutationCtx["db"] }, kind: RequestKind): Promise<string | null> {
  const settings = await ctx.db
    .query("trustSettings")
    .withIndex("by_key", (q) => q.eq("key", "public"))
    .unique();
  if (!settings) return null;
  if (kind === "privacy") return settings.verified.privacy ? settings.contacts.privacy : null;
  return settings.verified.security ? settings.contacts.security : null;
}

async function plannedNotify(ctx: { db: QueryCtx["db"] | MutationCtx["db"] }, kind: RequestKind): Promise<NotifyPlan> {
  if (!(await inboxFor(ctx, kind))) return { state: "not_configured", problem: "No verified inbox is set for this kind of request." };
  if (!emailProvider()) return { state: "not_configured", problem: "Email sending isn't set up yet, so the email wasn't sent." };
  return { state: "pending" };
}

/** Saves a request and plans the email about it. Used by the public form and by a company's Owner. */
export async function saveRequest(
  ctx: MutationCtx,
  fields: Omit<Doc<"trustRequests">, "_id" | "_creationTime" | "reference" | "receivedAt" | "status" | "notes" | "actions" | "notify" | "verification" | "routing"> &
    Partial<Pick<Doc<"trustRequests">, "verification" | "routing" | "status">>,
  firstAction: { by: string; action: string; detail: string },
): Promise<{ requestId: Id<"trustRequests">; reference: string }> {
  const now = Date.now();
  const reference = await newReference(ctx);
  const plan = await plannedNotify(ctx, fields.kind);
  const requestId = await ctx.db.insert("trustRequests", {
    ...fields,
    reference,
    receivedAt: now,
    status: fields.status ?? "received",
    routing: fields.routing ?? "selestial",
    verification: fields.verification ?? {},
    notes: [],
    actions: [{ at: now, ...firstAction }],
    notify: plan.state === "pending" ? { state: "pending", attempts: 0 } : { state: "not_configured", attempts: 0, lastAt: now, problem: plan.problem },
  });
  if (plan.state === "pending") await ctx.scheduler.runAfter(0, internal.requests.notify, { requestId });
  return { requestId, reference };
}

