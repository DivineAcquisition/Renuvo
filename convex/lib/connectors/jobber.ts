/**
 * Jobber: sign-in (OAuth 2.0 with refresh token rotation) and a read-only pull of clients, their first
 * property and their upcoming visits through Jobber's GraphQL API. Nothing is written to Jobber.
 *
 * Needs JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET from the app registered in Jobber's Developer Center, with
 * the redirect address `${CONVEX_SITE_URL}/oauth/jobber/callback` and read access to clients and scheduling.
 * Without them the connection reports that it is not available and nothing is attempted.
 *
 * Jobber rotates refresh tokens: every refresh returns a new one and the old one stops working, so the new
 * one is stored before anything else is read.
 */
import type { ImportRow } from "../clients/importing";
import {
  answer,
  clean,
  CLIENT_LIMIT,
  ConnectorError,
  scheduleNote,
  timed,
  VISIT_DAYS,
  VISIT_LIMIT,
  type Fetcher,
  type ReadResult,
} from "./common";

const AUTHORIZE = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL = "https://api.getjobber.com/api/graphql";
/** The API version Selestial is written against. Jobber supports a version for at least twelve months. */
export const JOBBER_API_VERSION = "2025-04-16";
const SYSTEM = "Jobber";

export type JobberApp = { clientId: string; clientSecret: string };

export function jobberApp(): JobberApp | null {
  const clientId = process.env.JOBBER_CLIENT_ID?.trim();
  const clientSecret = process.env.JOBBER_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function jobberRedirect(): string | null {
  const site = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  return site ? `${site}/oauth/jobber/callback` : null;
}

export function authorizeUrl(
  app: JobberApp,
  redirect: string,
  state: string,
): string {
  return `${AUTHORIZE}?${new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: redirect, state }).toString()}`;
}

export type JobberTokens = { accessToken: string; refreshToken: string };

async function tokenCall(
  fetcher: Fetcher,
  body: Record<string, string>,
): Promise<JobberTokens> {
  const response = await timed(
    fetcher,
    TOKEN,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body).toString(),
    },
    SYSTEM,
  );
  // Jobber answers a refresh token it no longer accepts with 400 or 401.
  if (response.status === 400 || response.status === 401)
    throw new ConnectorError(
      "auth",
      "Jobber ended this connection. Connect Jobber again.",
    );
  const json = (await answer(response, SYSTEM)) as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  if (
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string"
  )
    throw new ConnectorError(
      "failed",
      "Jobber did not return a usable sign-in.",
    );
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

export function exchange(
  app: JobberApp,
  code: string,
  redirect: string,
  fetcher: Fetcher,
): Promise<JobberTokens> {
  return tokenCall(fetcher, {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
  });
}

export function refreshTokens(
  app: JobberApp,
  refreshToken: string,
  fetcher: Fetcher,
): Promise<JobberTokens> {
  return tokenCall(fetcher, {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

type GraphqlError = { message?: string; extensions?: { code?: string } };

async function query<T>(
  fetcher: Fetcher,
  token: string,
  text: string,
  variables: Record<string, unknown>,
  wait: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await timed(
      fetcher,
      GRAPHQL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
        },
        body: JSON.stringify({ query: text, variables }),
      },
      SYSTEM,
    );
    const json = (await answer(response, SYSTEM)) as {
      data?: T;
      errors?: GraphqlError[];
    };
    const errors = json.errors ?? [];
    // Jobber limits by query cost and answers THROTTLED until its bucket refills.
    if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
      if (attempt >= 3)
        throw new ConnectorError(
          "limit",
          "Jobber asked Selestial to slow down. Try again in a few minutes.",
        );
      await wait(3000 * (attempt + 1));
      continue;
    }
    if (errors.length || !json.data)
      throw new ConnectorError(
        "failed",
        "Jobber's answer did not match what Selestial expects. Nothing was imported; try again later.",
      );
    return json.data;
  }
}

const ADDRESS = "street1 street2 city province postalCode";
export const CLIENTS_QUERY = `query SelestialClients($after: String) {
  clients(first: 50, after: $after) {
    nodes {
      id firstName lastName companyName isCompany isLead isArchived
      emails { address primary }
      phones { number primary }
      billingAddress { ${ADDRESS} }
      clientProperties(first: 5) { nodes { id address { ${ADDRESS} } } totalCount }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const VISITS_QUERY = `query SelestialVisits($after: String, $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
  visits(first: 100, after: $after, filter: { startAt: { after: $from, before: $to } }) {
    nodes { id startAt client { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const ACCOUNT_QUERY = "query SelestialAccount { account { name } }";

type Address = {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
} | null;
type Contact = { primary?: boolean | null };
export type JobberClient = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  isCompany?: boolean | null;
  isLead?: boolean | null;
  isArchived?: boolean | null;
  emails?: ({ address?: string | null } & Contact)[] | null;
  phones?: ({ number?: string | null } & Contact)[] | null;
  billingAddress?: Address;
  clientProperties?: {
    nodes?: { id: string; address?: Address }[] | null;
    totalCount?: number | null;
  } | null;
};
type Page<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

/**
 * Jobber's ids are encoded ("Z2lk…" is "gid://Jobber/Client/123"). The number at the end is the client id
 * Jobber's own exports show, so a client imported from a Jobber spreadsheet earlier is recognized.
 */
export function jobberNumber(id: string): string {
  try {
    const decoded = atob(id);
    const match = /\/(\d+)$/.exec(decoded);
    if (match) return match[1];
  } catch {
    // Not encoded: keep it as it is.
  }
  return id;
}

const primaryOf = <T extends Contact>(
  list: T[] | null | undefined,
): T | undefined =>
  (list ?? []).find((item) => item.primary) ?? (list ?? [])[0];

export function clientRow(
  client: JobberClient,
  schedule: string | undefined,
): ImportRow {
  const person = [clean(client.firstName), clean(client.lastName)]
    .filter(Boolean)
    .join(" ");
  const company = clean(client.companyName);
  const property = client.clientProperties?.nodes?.[0];
  const address = property?.address ?? client.billingAddress ?? null;
  const more =
    (client.clientProperties?.totalCount ??
      client.clientProperties?.nodes?.length ??
      0) - 1;
  const notes = [
    client.isLead ? "A lead in Jobber, not yet a client there." : null,
    more > 0
      ? `Has ${more} more ${more === 1 ? "property" : "properties"} in Jobber.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    name: (client.isCompany && company
      ? company
      : person || company || ""
    ).slice(0, 160),
    type: client.isCompany ? "business" : "person",
    email: clean(primaryOf(client.emails)?.address),
    phone: clean(primaryOf(client.phones)?.number),
    line1: clean(address?.street1),
    line2: clean(address?.street2),
    city: clean(address?.city),
    region: clean(address?.province),
    postalCode: clean(address?.postalCode),
    notes: notes || undefined,
    schedule,
    externalId: jobberNumber(client.id),
  };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads the account's clients (archived ones left out) and the next 60 days of visits. */
export async function readJobber(
  fetcher: Fetcher,
  accessToken: string,
  input: {
    now: number;
    timezone: string;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<ReadResult> {
  const wait = input.wait ?? sleep;
  const account = await query<{ account?: { name?: string | null } | null }>(
    fetcher,
    accessToken,
    ACCOUNT_QUERY,
    {},
    wait,
  );

  const starts = new Map<string, number[]>();
  let visits = 0;
  let after: string | null = null;
  const from = new Date(input.now).toISOString();
  const to = new Date(input.now + VISIT_DAYS * 86_400_000).toISOString();
  do {
    const data: {
      visits: Page<{
        id: string;
        startAt?: string | null;
        client?: { id: string } | null;
      }>;
    } = await query(
      fetcher,
      accessToken,
      VISITS_QUERY,
      { after, from, to },
      wait,
    );
    for (const visit of data.visits.nodes) {
      const at = visit.startAt ? Date.parse(visit.startAt) : NaN;
      if (!visit.client?.id || !Number.isFinite(at)) continue;
      visits += 1;
      starts.set(visit.client.id, [...(starts.get(visit.client.id) ?? []), at]);
    }
    after = data.visits.pageInfo.hasNextPage
      ? data.visits.pageInfo.endCursor
      : null;
  } while (after && visits < VISIT_LIMIT);

  const rows: ImportRow[] = [];
  let truncated = false;
  after = null;
  do {
    const data: { clients: Page<JobberClient> } = await query(
      fetcher,
      accessToken,
      CLIENTS_QUERY,
      { after },
      wait,
    );
    for (const client of data.clients.nodes) {
      if (client.isArchived) continue;
      if (rows.length >= CLIENT_LIMIT) {
        truncated = true;
        break;
      }
      rows.push(
        clientRow(
          client,
          scheduleNote(SYSTEM, starts.get(client.id) ?? [], input.timezone),
        ),
      );
    }
    after = data.clients.pageInfo.hasNextPage
      ? data.clients.pageInfo.endCursor
      : null;
    if (after && rows.length >= CLIENT_LIMIT) truncated = true;
  } while (after && !truncated);

  return {
    account: clean(account.account?.name) ?? null,
    rows,
    visits,
    truncated,
  };
}
