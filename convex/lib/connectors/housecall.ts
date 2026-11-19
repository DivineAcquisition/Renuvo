/**
 * Housecall Pro: a read-only pull of customers, their service address and their upcoming jobs, with an API
 * key an Admin creates in Housecall Pro (its API is offered on the MAX plan). Nothing is written to
 * Housecall Pro. The key is sealed before it is stored and is never sent back to a browser.
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

const BASE = "https://api.housecallpro.com";
const SYSTEM = "Housecall Pro";
const PAGE_SIZE = 100;

/** A key as Housecall Pro shows it: letters, digits and a few separators, nothing else. */
export function keyProblem(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length < 16)
    return "That key looks too short. Copy the whole key from Housecall Pro.";
  if (trimmed.length > 200 || !/^[A-Za-z0-9._\-]+$/.test(trimmed))
    return "That doesn't look like a Housecall Pro API key.";
  return null;
}

async function get<T>(fetcher: Fetcher, key: string, path: string): Promise<T> {
  const response = await timed(
    fetcher,
    `${BASE}${path}`,
    {
      method: "GET",
      headers: {
        Authorization: `Token ${key.trim()}`,
        Accept: "application/json",
      },
    },
    SYSTEM,
  );
  if (response.status === 401)
    throw new ConnectorError(
      "auth",
      "Housecall Pro didn't accept this API key. Check it, or create a new one in Housecall Pro.",
    );
  if (response.status === 403)
    throw new ConnectorError(
      "auth",
      "Housecall Pro refused this key. Its API needs an Admin's key on a plan that includes the API.",
    );
  return (await answer(response, SYSTEM)) as T;
}

type HcpAddress = {
  street?: string | null;
  street_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  type?: string | null;
};
export type HcpCustomer = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  email?: string | null;
  mobile_number?: string | null;
  home_number?: string | null;
  work_number?: string | null;
  addresses?: HcpAddress[] | null;
};
type HcpJob = {
  id: string;
  customer?: { id?: string | null } | null;
  schedule?: { scheduled_start?: string | null } | null;
  work_status?: string | null;
};

export function customerRow(
  customer: HcpCustomer,
  schedule: string | undefined,
): ImportRow {
  const person = [clean(customer.first_name), clean(customer.last_name)]
    .filter(Boolean)
    .join(" ");
  const company = clean(customer.company);
  const addresses = customer.addresses ?? [];
  const address = addresses.find((a) => a.type === "service") ?? addresses[0];
  const more = addresses.filter((a) => a.type !== "billing").length - 1;
  return {
    name: (person || company || "").slice(0, 160),
    type: !person && company ? "business" : "person",
    email: clean(customer.email),
    phone:
      clean(customer.mobile_number) ??
      clean(customer.home_number) ??
      clean(customer.work_number),
    line1: clean(address?.street),
    line2: clean(address?.street_line_2),
    city: clean(address?.city),
    region: clean(address?.state),
    postalCode: clean(address?.zip),
    notes:
      [
        person && company ? `Company in Housecall Pro: ${company}.` : null,
        more > 0
          ? `Has ${more} more service ${more === 1 ? "address" : "addresses"} in Housecall Pro.`
          : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    schedule,
    externalId: customer.id,
  };
}

/** Checks the key and reads the company's name. */
export async function housecallAccount(
  fetcher: Fetcher,
  key: string,
): Promise<string | null> {
  const company = await get<{ name?: string | null }>(fetcher, key, "/company");
  return clean(company.name) ?? null;
}

export async function readHousecall(
  fetcher: Fetcher,
  key: string,
  input: { now: number; timezone: string },
): Promise<ReadResult> {
  const account = await housecallAccount(fetcher, key);

  const starts = new Map<string, number[]>();
  let visits = 0;
  const from = new Date(input.now).toISOString();
  const to = new Date(input.now + VISIT_DAYS * 86_400_000).toISOString();
  for (let page = 1; visits < VISIT_LIMIT; page += 1) {
    const data = await get<{ jobs?: HcpJob[]; total_pages?: number }>(
      fetcher,
      key,
      `/jobs?${new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), scheduled_start_min: from, scheduled_start_max: to }).toString()}`,
    );
    for (const job of data.jobs ?? []) {
      const at = job.schedule?.scheduled_start
        ? Date.parse(job.schedule.scheduled_start)
        : NaN;
      const customerId = job.customer?.id;
      if (
        !customerId ||
        !Number.isFinite(at) ||
        /cancel/i.test(job.work_status ?? "")
      )
        continue;
      visits += 1;
      starts.set(customerId, [...(starts.get(customerId) ?? []), at]);
    }
    if (
      !data.total_pages ||
      page >= data.total_pages ||
      !(data.jobs ?? []).length
    )
      break;
  }

  const rows: ImportRow[] = [];
  let truncated = false;
  for (let page = 1; ; page += 1) {
    const data = await get<{ customers?: HcpCustomer[]; total_pages?: number }>(
      fetcher,
      key,
      `/customers?${new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) }).toString()}`,
    );
    for (const customer of data.customers ?? []) {
      if (rows.length >= CLIENT_LIMIT) {
        truncated = true;
        break;
      }
      rows.push(
        customerRow(
          customer,
          scheduleNote(SYSTEM, starts.get(customer.id) ?? [], input.timezone),
        ),
      );
    }
    const last =
      !data.total_pages ||
      page >= data.total_pages ||
      !(data.customers ?? []).length;
    if (!last && rows.length >= CLIENT_LIMIT) truncated = true;
    if (last || truncated) break;
  }
  return { account, rows, visits, truncated };
}
