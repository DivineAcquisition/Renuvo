/**
 * Bringing clients in from Jobber or Housecall Pro during setup (lib/connectors/*). Only the Owner connects
 * or disconnects. A connection only reads; nothing is written to the other system.
 *
 * Jobber: `startJobber` returns Jobber's sign-in address with a one-time state (only its hash is kept, for
 * ten minutes). Jobber returns to /oauth/jobber/callback; the code is exchanged, the refresh token sealed to
 * the connection, and a read starts. Housecall Pro: the Owner pastes an Admin's API key; it is sealed at
 * once and checked in the background before the connection counts as connected.
 *
 * A read brings back up to 1,000 clients with their first property and a note of their upcoming visits. It
 * is kept for a day for the owner to check and import through clientImports, the same path as a
 * spreadsheet, so duplicates, retries and "imported before" work the same way. No visit is booked and
 * importing a phone number or email is not permission to contact anyone.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  companyQuery,
  managerMutation,
  managerQuery,
  ownerMutation,
} from "./lib/builders";
import {
  ConnectorError,
  type Fetcher,
  type ReadResult,
} from "./lib/connectors/common";
import {
  housecallAccount,
  keyProblem,
  readHousecall,
} from "./lib/connectors/housecall";
import {
  authorizeUrl,
  exchange,
  jobberApp,
  jobberRedirect,
  readJobber,
  refreshTokens,
} from "./lib/connectors/jobber";
import {
  connectorSystemValidator,
  importRowValidator,
  type ConnectorSystem,
} from "./lib/connectors/schema";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { appOrigin, returnOrigin } from "./lib/invitations";
import {
  hashToken,
  randomToken,
  seal,
  secretsConfigured,
  unseal,
} from "./lib/recruiter/secrets";

const STATE_LIFE = 10 * 60 * 1000;
const READ_LIFE = 24 * 60 * 60 * 1000;
/** A read still "reading" after this long is treated as stopped, so another can start. */
const READ_STALE = 15 * 60 * 1000;
const NAMES: Record<ConnectorSystem, string> = {
  jobber: "Jobber",
  housecall_pro: "Housecall Pro",
};

let fetcher: Fetcher | null = null;
/** Tests only: every request to Jobber or Housecall Pro goes here instead of the network. */
export function setConnectorFetchForTests(next: Fetcher | null) {
  fetcher = next;
}
const go: Fetcher = (url, init) => (fetcher ?? fetch)(url, init);
const noWait = async () => {};

async function connectionOf(
  ctx: { db: QueryCtx["db"] },
  companyId: Id<"companies">,
  system: ConnectorSystem,
) {
  return ctx.db
    .query("connectorConnections")
    .withIndex("by_company_system", (q) =>
      q.eq("companyId", companyId).eq("system", system),
    )
    .order("desc")
    .first();
}

async function latestRead(
  ctx: { db: QueryCtx["db"] },
  companyId: Id<"companies">,
) {
  return ctx.db
    .query("connectorReads")
    .withIndex("by_company_started", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
}

export function afterJobber(outcome: string, origin?: string | null): string {
  return `${returnOrigin(origin) ?? appOrigin() ?? ""}/app/setup?connector=jobber&result=${encodeURIComponent(outcome)}`;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

const shapeConnection = (row: Doc<"connectorConnections"> | null) =>
  row && row.status !== "disconnected"
    ? {
        status: row.status,
        account: row.account ?? null,
        problem: row.problem ?? null,
        connectedAt: row.connectedAt,
        lastReadAt: row.lastReadAt ?? null,
      }
    : null;

/** Where each connection stands and the latest read, without its rows. Anyone in the company may see it. */
export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const sealing = await secretsConfigured();
    const read = await latestRead(ctx, ctx.companyId);
    const live = read && read.startedAt > Date.now() - READ_LIFE ? read : null;
    return {
      canManage: ctx.role === "owner",
      jobber: {
        available: sealing && jobberApp() !== null && jobberRedirect() !== null,
        connection: shapeConnection(
          await connectionOf(ctx, ctx.companyId, "jobber"),
        ),
      },
      housecall: {
        available: sealing,
        connection: shapeConnection(
          await connectionOf(ctx, ctx.companyId, "housecall_pro"),
        ),
      },
      read: live
        ? {
            id: live._id,
            system: live.system,
            status:
              live.status === "reading" &&
              live.startedAt < Date.now() - READ_STALE
                ? ("failed" as const)
                : live.status,
            clients: live.rows.length,
            visits: live.visits,
            truncated: live.truncated,
            problem:
              live.status === "reading" &&
              live.startedAt < Date.now() - READ_STALE
                ? "The read stopped before it finished. Try again."
                : (live.problem ?? null),
            startedAt: live.startedAt,
            finishedAt: live.finishedAt ?? null,
          }
        : null,
    };
  },
});

/** The rows of a finished read, for the owner to check and import. The same people who may import see them. */
export const readRows = managerQuery({
  args: { readId: v.id("connectorReads") },
  handler: async (ctx, args) => {
    const read = await ctx.db.get(args.readId);
    if (!read || read.companyId !== ctx.companyId || read.status !== "ready")
      notFound();
    return {
      system: read.system,
      rows: read.rows,
      label: `${NAMES[read.system]} · read ${new Date(read.startedAt).toISOString().slice(0, 10)}`,
    };
  },
});

// ── Jobber sign-in ──────────────────────────────────────────────────────────────────────────────

export const startJobber = ownerMutation({
  args: { returnTo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const app = jobberApp();
    const redirect = jobberRedirect();
    if (!app || !redirect || !(await secretsConfigured()))
      throw userError(
        "Connecting Jobber isn’t available yet. Use a Jobber export for now.",
      );
    const state = await randomToken();
    await ctx.db.insert("connectorStates", {
      companyId: ctx.companyId,
      memberId: ctx.member._id,
      stateHash: await hashToken(state),
      returnOrigin: returnOrigin(args.returnTo) ?? undefined,
      expiresAt: Date.now() + STATE_LIFE,
    });
    await recordEvent(ctx, {
      companyId: ctx.companyId,
      type: "connector.connect_started",
      actor: byMember(ctx),
      subject: { table: "companies", id: ctx.companyId },
      data: { system: "jobber" },
    });
    return { url: authorizeUrl(app, redirect, state) };
  },
});

/** Uses a state once, and only for someone who is still the company's Owner. */
export const takeState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("connectorStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!row) return { kind: "unknown" as const };
    const fresh = row.usedAt === undefined && row.expiresAt > Date.now();
    await ctx.db.patch(row._id, { usedAt: row.usedAt ?? Date.now() });
    const member = await ctx.db.get(row.memberId);
    if (
      !fresh ||
      !member ||
      member.companyId !== row.companyId ||
      member.status !== "active" ||
      member.role !== "owner"
    )
      return {
        kind: "expired" as const,
        returnOrigin: row.returnOrigin ?? null,
      };
    return {
      kind: "ok" as const,
      companyId: row.companyId,
      memberId: row.memberId,
      returnOrigin: row.returnOrigin ?? null,
    };
  },
});

/** Records a connection and its sealed credential together, replacing any earlier one for the same system. */
export const saveConnection = internalMutation({
  args: {
    companyId: v.id("companies"),
    memberId: v.id("members"),
    system: connectorSystemValidator,
    credential: v.string(),
    status: v.union(v.literal("checking"), v.literal("connected")),
    account: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true; connectionId: Id<"connectorConnections"> } | { ok: false }
  > => {
    return saveConnectionIn(ctx, args);
  },
});

type SaveArgs = {
  companyId: Id<"companies">;
  memberId: Id<"members">;
  system: ConnectorSystem;
  credential: string;
  status: "checking" | "connected";
  account?: string;
};

async function saveConnectionIn(
  ctx: MutationCtx,
  args: SaveArgs,
): Promise<
  { ok: true; connectionId: Id<"connectorConnections"> } | { ok: false }
> {
  const before = await connectionOf(ctx, args.companyId, args.system);
  if (before && before.status !== "disconnected")
    await dropConnection(ctx, before, false);
  const connectionId = await ctx.db.insert("connectorConnections", {
    companyId: args.companyId,
    system: args.system,
    status: args.status,
    account: args.account?.slice(0, 120),
    connectedBy: args.memberId,
    connectedAt: Date.now(),
  });
  const sealed = await seal(args.credential, connectionId);
  if (!sealed) {
    await ctx.db.patch(connectionId, {
      status: "disconnected",
      disconnectedAt: Date.now(),
      problem: "The connection could not be stored safely.",
    });
    return { ok: false };
  }
  await ctx.db.insert("connectorCredentials", {
    companyId: args.companyId,
    connectionId,
    sealed,
    createdAt: Date.now(),
  });
  await recordEvent(ctx, {
    companyId: args.companyId,
    type: "connector.connected",
    actor: { kind: "member", memberId: args.memberId },
    subject: { table: "companies", id: args.companyId },
    data: { system: args.system },
  });
  return { ok: true, connectionId };
}

/** Deletes the credential and any read kept from the connection. The connection row stays, marked disconnected. */
async function dropConnection(
  ctx: MutationCtx,
  connection: Doc<"connectorConnections">,
  keepReads: boolean,
  status: "disconnected" | "expired" = "disconnected",
  problem?: string,
) {
  for (const credential of await ctx.db
    .query("connectorCredentials")
    .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
    .take(10))
    await ctx.db.delete(credential._id);
  if (!keepReads) {
    for (const read of await ctx.db
      .query("connectorReads")
      .withIndex("by_company_started", (q) =>
        q.eq("companyId", connection.companyId),
      )
      .take(50))
      if (read.connectionId === connection._id) await ctx.db.delete(read._id);
  }
  await ctx.db.patch(connection._id, {
    status,
    problem,
    ...(status === "disconnected" ? { disconnectedAt: Date.now() } : {}),
  });
}

/** Where Jobber sends the Owner back. Returns the address to send them on to. */
export async function jobberCallback(
  ctx: ActionCtx,
  params: URLSearchParams,
): Promise<string> {
  const state = params.get("state");
  if (!state || state.length > 200) return afterJobber("failed");
  const taken = await ctx.runMutation(internal.connectors.takeState, {
    stateHash: await hashToken(state),
  });
  if (taken.kind === "unknown") return afterJobber("failed");
  if (taken.kind === "expired")
    return afterJobber("expired", taken.returnOrigin);
  const app = jobberApp();
  const redirect = jobberRedirect();
  const code = params.get("code");
  if (!code || params.get("error") || !app || !redirect)
    return afterJobber(
      params.get("error") === "access_denied" ? "declined" : "failed",
      taken.returnOrigin,
    );
  let refreshToken: string;
  try {
    refreshToken = (await exchange(app, code, redirect, go)).refreshToken;
  } catch {
    return afterJobber("failed", taken.returnOrigin);
  }
  // The account's name is filled in by the first read.
  const saved = await ctx.runMutation(internal.connectors.saveConnection, {
    companyId: taken.companyId,
    memberId: taken.memberId,
    system: "jobber",
    credential: refreshToken,
    status: "connected",
  });
  if (!saved.ok) return afterJobber("failed", taken.returnOrigin);
  await ctx.runMutation(internal.connectors.queueRead, {
    companyId: taken.companyId,
    memberId: taken.memberId,
    system: "jobber",
  });
  return afterJobber("connected", taken.returnOrigin);
}

// ── Housecall Pro key ───────────────────────────────────────────────────────────────────────────

export const connectHousecall = ownerMutation({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const problem = keyProblem(args.apiKey);
    if (problem) throw userError(problem);
    if (!(await secretsConfigured()))
      throw userError(
        "Connecting Housecall Pro isn’t available yet. Use a Housecall Pro export for now.",
      );
    const saved = await saveConnectionIn(ctx, {
      companyId: ctx.companyId,
      memberId: ctx.member._id,
      system: "housecall_pro",
      credential: args.apiKey.trim(),
      status: "checking",
    });
    if (!saved.ok)
      throw userError(
        "Connecting Housecall Pro isn’t available yet. Use a Housecall Pro export for now.",
      );
    await ctx.scheduler.runAfter(0, internal.connectors.checkHousecall, {
      connectionId: saved.connectionId,
    });
    return { connectionId: saved.connectionId };
  },
});

export const credentialFor = internalQuery({
  args: { connectionId: v.id("connectorConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.status === "disconnected" ||
      connection.status === "expired"
    )
      return null;
    const credential = await ctx.db
      .query("connectorCredentials")
      .withIndex("by_connection", (q) =>
        q.eq("connectionId", args.connectionId),
      )
      .first();
    const company = await ctx.db.get(connection.companyId);
    return credential && company
      ? { connection, sealed: credential.sealed, timezone: company.timezone }
      : null;
  },
});

export const checkHousecall = internalAction({
  args: { connectionId: v.id("connectorConnections") },
  handler: async (ctx, args): Promise<null> => {
    const found = await ctx.runQuery(internal.connectors.credentialFor, args);
    if (!found || found.connection.status !== "checking") return null;
    const key = await unseal(found.sealed, args.connectionId);
    if (!key) {
      await ctx.runMutation(internal.connectors.checked, {
        connectionId: args.connectionId,
        ok: false,
        problem: "The key could not be read back. Paste it again.",
      });
      return null;
    }
    try {
      const account = await housecallAccount(go, key);
      await ctx.runMutation(internal.connectors.checked, {
        connectionId: args.connectionId,
        ok: true,
        account: account ?? undefined,
      });
    } catch (error) {
      await ctx.runMutation(internal.connectors.checked, {
        connectionId: args.connectionId,
        ok: false,
        problem:
          error instanceof ConnectorError
            ? error.message
            : "Housecall Pro could not be reached. Try again in a few minutes.",
      });
    }
    return null;
  },
});

/** A refused key is removed at once: nothing that does not work is kept. An accepted key starts a read. */
export const checked = internalMutation({
  args: {
    connectionId: v.id("connectorConnections"),
    ok: v.boolean(),
    account: v.optional(v.string()),
    problem: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "checking") return null;
    if (!args.ok) {
      // Marked "expired" rather than disconnected, so the screen still shows why.
      await dropConnection(ctx, connection, false, "expired", args.problem);
      return null;
    }
    await ctx.db.patch(connection._id, {
      status: "connected",
      account: args.account?.slice(0, 120),
      problem: undefined,
    });
    await queueReadIn(ctx, {
      companyId: connection.companyId,
      memberId: connection.connectedBy,
      system: "housecall_pro",
    });
    return null;
  },
});

// ── Reading clients ─────────────────────────────────────────────────────────────────────────────

async function queueReadIn(
  ctx: MutationCtx,
  args: {
    companyId: Id<"companies">;
    memberId: Id<"members">;
    system: ConnectorSystem;
  },
) {
  const connection = await connectionOf(ctx, args.companyId, args.system);
  if (!connection || connection.status !== "connected")
    throw userError(`Connect ${NAMES[args.system]} first.`);
  const running = await latestRead(ctx, args.companyId);
  if (
    running?.status === "reading" &&
    running.startedAt > Date.now() - READ_STALE
  )
    return running._id;
  const readId = await ctx.db.insert("connectorReads", {
    companyId: args.companyId,
    connectionId: connection._id,
    system: args.system,
    status: "reading",
    rows: [],
    visits: 0,
    truncated: false,
    requestedBy: args.memberId,
    startedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.connectors.run, { readId });
  await ctx.scheduler.runAfter(READ_LIFE, internal.connectors.forget, {
    readId,
  });
  return readId;
}

export const queueRead = internalMutation({
  args: {
    companyId: v.id("companies"),
    memberId: v.id("members"),
    system: connectorSystemValidator,
  },
  handler: async (ctx, args) => queueReadIn(ctx, args),
});

/** The Owner reads again, for example after adding clients in the other system. */
export const read = ownerMutation({
  args: { system: connectorSystemValidator },
  handler: async (ctx, args) =>
    queueReadIn(ctx, {
      companyId: ctx.companyId,
      memberId: ctx.member._id,
      system: args.system,
    }),
});

export const readContext = internalQuery({
  args: { readId: v.id("connectorReads") },
  handler: async (ctx, args) => {
    const read = await ctx.db.get(args.readId);
    if (!read || read.status !== "reading") return null;
    return { read: { system: read.system, connectionId: read.connectionId } };
  },
});

export const run = internalAction({
  args: { readId: v.id("connectorReads") },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.connectors.readContext, args);
    if (!context) return null;
    const { connectionId, system } = context.read;
    const found = await ctx.runQuery(internal.connectors.credentialFor, {
      connectionId,
    });
    if (!found) {
      await ctx.runMutation(internal.connectors.finish, {
        readId: args.readId,
        problem: `${NAMES[system]} is no longer connected.`,
      });
      return null;
    }
    const secret = await unseal(found.sealed, connectionId);
    if (!secret) {
      await ctx.runMutation(internal.connectors.finish, {
        readId: args.readId,
        problem: `The ${NAMES[system]} connection could not be read back. Connect it again.`,
        expire: true,
      });
      return null;
    }
    const input = {
      now: Date.now(),
      timezone: found.timezone,
      wait: fetcher ? noWait : undefined,
    };
    let result: ReadResult;
    try {
      if (system === "jobber") {
        const app = jobberApp();
        if (!app)
          throw new ConnectorError(
            "failed",
            "Connecting Jobber isn’t available right now.",
          );
        const tokens = await refreshTokens(app, secret, go);
        // Jobber has already retired the old refresh token: keep the new one before reading anything.
        const stored = await ctx.runMutation(internal.connectors.rotate, {
          connectionId,
          credential: tokens.refreshToken,
        });
        if (!stored)
          throw new ConnectorError(
            "failed",
            "Jobber's new sign-in could not be stored safely.",
          );
        result = await readJobber(go, tokens.accessToken, input);
      } else {
        result = await readHousecall(go, secret, input);
      }
    } catch (error) {
      const known = error instanceof ConnectorError ? error : null;
      await ctx.runMutation(internal.connectors.finish, {
        readId: args.readId,
        problem:
          known?.message ??
          `${NAMES[system]} could not be read. Try again in a few minutes.`,
        expire: known?.kind === "auth",
      });
      return null;
    }
    await ctx.runMutation(internal.connectors.finish, {
      readId: args.readId,
      rows: result.rows,
      visits: result.visits,
      truncated: result.truncated,
      account: result.account ?? undefined,
    });
    return null;
  },
});

/** Stores Jobber's rotated refresh token in place of the old one. */
export const rotate = internalMutation({
  args: { connectionId: v.id("connectorConnections"), credential: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "connected") return false;
    const sealed = await seal(args.credential, args.connectionId);
    if (!sealed) return false;
    const current = await ctx.db
      .query("connectorCredentials")
      .withIndex("by_connection", (q) =>
        q.eq("connectionId", args.connectionId),
      )
      .first();
    if (current)
      await ctx.db.patch(current._id, { sealed, createdAt: Date.now() });
    else
      await ctx.db.insert("connectorCredentials", {
        companyId: connection.companyId,
        connectionId: args.connectionId,
        sealed,
        createdAt: Date.now(),
      });
    return true;
  },
});

export const finish = internalMutation({
  args: {
    readId: v.id("connectorReads"),
    rows: v.optional(v.array(importRowValidator)),
    visits: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    account: v.optional(v.string()),
    problem: v.optional(v.string()),
    expire: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const read = await ctx.db.get(args.readId);
    if (!read || read.status !== "reading") return null;
    const connection = await ctx.db.get(read.connectionId);
    const now = Date.now();
    if (args.problem !== undefined) {
      await ctx.db.patch(read._id, {
        status: "failed",
        problem: args.problem,
        finishedAt: now,
      });
      // The other system ended the authorization: the credential is removed and the owner connects again.
      if (args.expire && connection && connection.status === "connected")
        await dropConnection(ctx, connection, true, "expired", args.problem);
      return null;
    }
    await ctx.db.patch(read._id, {
      status: "ready",
      rows: args.rows ?? [],
      visits: args.visits ?? 0,
      truncated: args.truncated ?? false,
      finishedAt: now,
    });
    if (connection)
      await ctx.db.patch(connection._id, {
        lastReadAt: now,
        ...(args.account ? { account: args.account.slice(0, 120) } : {}),
      });
    await recordEvent(ctx, {
      companyId: read.companyId,
      type: "connector.read",
      actor: { kind: "member", memberId: read.requestedBy },
      subject: { table: "companies", id: read.companyId },
      data: {
        system: read.system,
        clients: (args.rows ?? []).length,
        visits: args.visits ?? 0,
      },
    });
    return null;
  },
});

/** A read is a copy of another system's records: it is kept for a day at most. */
export const forget = internalMutation({
  args: { readId: v.id("connectorReads") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.readId)) await ctx.db.delete(args.readId);
    return null;
  },
});

/** The owner is done with a read (imported or not): its copy is deleted now. */
export const discard = managerMutation({
  args: { readId: v.id("connectorReads") },
  handler: async (ctx, args) => {
    const read = await ctx.db.get(args.readId);
    if (!read || read.companyId !== ctx.companyId) return null;
    await ctx.db.delete(read._id);
    return null;
  },
});

/**
 * Stops at once: the credential and any read kept from the connection are deleted. Jobber's own record of
 * the app is ended in Jobber (Settings › Apps), which the screen says; Selestial can no longer use it either way.
 */
export const disconnect = ownerMutation({
  args: { system: connectorSystemValidator },
  handler: async (ctx, args) => {
    const connection = await connectionOf(ctx, ctx.companyId, args.system);
    if (!connection || connection.status === "disconnected") return null;
    await dropConnection(ctx, connection, false);
    await recordEvent(ctx, {
      companyId: ctx.companyId,
      type: "connector.disconnected",
      actor: byMember(ctx),
      subject: { table: "companies", id: ctx.companyId },
      data: { system: args.system },
    });
    return null;
  },
});
