/**
 * The company's Google connection inside Convex: reading it with the member's access, and the rules every
 * Google step checks before it touches Google. A connection that is disconnected or expired does nothing;
 * a resource that was not authorized is not used; a feature whose scopes were not granted is refused.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import { enabledFeatures, FEATURE_INFO, type Feature } from "./features";

type Ctx = QueryCtx | MutationCtx;

/** This tool's connection (connected or expired), if the Owner set one up. Each tool has its own. */
export async function activeConnection(ctx: Ctx, companyId: Id<"companies">, feature: Feature): Promise<Doc<"googleConnections"> | null> {
  const rows = await ctx.db.query("googleConnections").withIndex("by_company_feature", (q) => q.eq("companyId", companyId).eq("feature", feature)).take(10);
  return rows.find((row) => row.status !== "disconnected") ?? null;
}

/** Every tool's connection that is not disconnected. */
export async function activeConnections(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"googleConnections">[]> {
  const rows = await ctx.db.query("googleConnections").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(50);
  return rows.filter((row) => row.status !== "disconnected" && row.feature);
}

/** The tool's connection, ready to use, or a plain reason it is not. */
export async function requireFeature(ctx: Ctx, companyId: Id<"companies">, feature: Feature): Promise<Doc<"googleConnections">> {
  const label = FEATURE_INFO[feature].label;
  const connection = await activeConnection(ctx, companyId, feature);
  if (!connection) throw userError(`${label} is not connected for this company. The Owner connects it under Settings › Integrations.`);
  if (connection.status === "expired") throw userError(`${label}'s Google authorization for ${connection.email} has ended. The Owner needs to reconnect it.`);
  if (!enabledFeatures(connection.grantedScopes).includes(feature)) throw userError(`Google did not grant everything ${label} needs. The Owner can reconnect it under Settings › Integrations.`);
  return connection;
}

/** A resource the Owner authorized for this purpose. Anything else is refused, whatever its id. */
export async function authorizedResource(ctx: Ctx, companyId: Id<"companies">, kind: Doc<"googleResources">["kind"], externalId?: string): Promise<Doc<"googleResources"> | null> {
  const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", companyId).eq("kind", kind)).take(200);
  const usable = rows.filter((row) => row.access !== "lost");
  return externalId === undefined ? (usable[0] ?? null) : (usable.find((row) => row.externalId === externalId) ?? null);
}

export const isUsable = (connection: Pick<Doc<"googleConnections">, "status"> | null) => connection?.status === "connected";
