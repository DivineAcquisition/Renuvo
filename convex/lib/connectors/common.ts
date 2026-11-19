/**
 * What the Jobber and Housecall Pro readers share: the error kinds, the limits, and turning upcoming visits
 * into a schedule note on each client. Pure; the network is passed in.
 */
import { ROW_LIMIT } from "../clients/importing";

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** auth: the other system no longer accepts the credential. limit: it asked to slow down. */
export class ConnectorError extends Error {
  constructor(
    readonly kind: "auth" | "limit" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/** The same cap as a spreadsheet: one import takes up to this many clients. */
export const CLIENT_LIMIT = ROW_LIMIT;
/** Visits read ahead, and at most how many. */
export const VISIT_DAYS = 60;
export const VISIT_LIMIT = 2000;
export const REQUEST_TIMEOUT_MS = 20_000;

export type ReadResult = {
  account: string | null;
  rows: import("../clients/importing").ImportRow[];
  visits: number;
  truncated: boolean;
};

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 300)
    : undefined;
export { clean };

/** "Upcoming in Jobber: Tue, Nov 25; Tue, Dec 2 and 3 more." in the company's time zone. */
export function scheduleNote(
  system: string,
  starts: number[],
  timezone: string,
): string | undefined {
  const sorted = [...new Set(starts)]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const shown = sorted.slice(0, 3).map((at) => format.format(new Date(at)));
  const more = sorted.length - shown.length;
  return `Upcoming in ${system}: ${shown.join("; ")}${more > 0 ? ` and ${more} more` : ""}. Not booked in Selestial.`;
}

/** A response the reader can use, or the error that says why not. */
export async function answer(
  response: Response,
  system: string,
): Promise<unknown> {
  if (response.status === 401)
    throw new ConnectorError(
      "auth",
      `${system} no longer accepts this connection. Connect it again.`,
    );
  if (response.status === 403)
    throw new ConnectorError(
      "auth",
      `${system} refused access for this account.`,
    );
  if (response.status === 429)
    throw new ConnectorError(
      "limit",
      `${system} asked Selestial to slow down. Try again in a few minutes.`,
    );
  if (!response.ok)
    throw new ConnectorError(
      "failed",
      `${system} answered with an error (${response.status}). Try again later.`,
    );
  try {
    return await response.json();
  } catch {
    throw new ConnectorError(
      "failed",
      `${system} sent an answer Selestial could not read.`,
    );
  }
}

export async function timed(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  system: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
  } catch {
    throw new ConnectorError(
      "failed",
      `${system} could not be reached. Try again in a few minutes.`,
    );
  } finally {
    clearTimeout(timer);
  }
}
