/**
 * @vitest-environment edge-runtime
 *
 * Bringing clients in from Jobber and Housecall Pro, against stand-ins for both: nothing reaches the
 * network, and every name and address here is made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { setConnectorFetchForTests } from "./connectors";
import { customerRow, keyProblem } from "./lib/connectors/housecall";
import { clientRow, jobberNumber } from "./lib/connectors/jobber";
import { scheduleNote } from "./lib/connectors/common";
import { unseal } from "./lib/recruiter/secrets";

const KEY = btoa(
  String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 11)),
);
const ENV = {
  JOBBER_CLIENT_ID: "jobber-client-test",
  JOBBER_CLIENT_SECRET: "jobber-secret-not-real",
  MAILBOX_TOKEN_KEY: KEY,
  CONVEX_SITE_URL: "https://deployment.convex.site.test",
  APP_ORIGIN: "https://app.selestial.test",
};
const HCP_KEY = "hcp_test_key_0123456789abcdef";

const gid = (kind: string, n: number) => btoa(`gid://Jobber/${kind}/${n}`);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type Call = { url: string; method: string; body: string; auth: string | null };

/** A stand-in Jobber: token endpoint and GraphQL, told apart by the operation name in the query. */
function fakeJobber(
  input: {
    refresh?: "ok" | "rejected";
    clients?: unknown[];
    visits?: unknown[];
  } = {},
) {
  const calls: Call[] = [];
  let issued = 0;
  setConnectorFetchForTests(async (url, init) => {
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({
      url,
      method: init.method ?? "GET",
      body,
      auth: new Headers(init.headers).get("Authorization"),
    });
    if (url === "https://api.getjobber.com/api/oauth/token") {
      const params = new URLSearchParams(body);
      if (
        params.get("grant_type") === "refresh_token" &&
        input.refresh === "rejected"
      )
        return json({ error: "invalid_grant" }, 401);
      issued += 1;
      return json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
      });
    }
    if (url === "https://api.getjobber.com/api/graphql") {
      const query = (JSON.parse(body) as { query: string }).query;
      if (query.includes("SelestialAccount"))
        return json({ data: { account: { name: "Test Cleaning Co" } } });
      if (query.includes("SelestialVisits"))
        return json({
          data: {
            visits: {
              nodes: input.visits ?? [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      if (query.includes("SelestialClients"))
        return json({
          data: {
            clients: {
              nodes: input.clients ?? [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
    }
    return json({ error: "not faked" }, 404);
  });
  return calls;
}

const CLIENTS = [
  {
    id: gid("Client", 101),
    firstName: "Avery",
    lastName: "Test",
    companyName: null,
    isCompany: false,
    isLead: false,
    isArchived: false,
    emails: [{ address: "avery@example.test", primary: true }],
    phones: [{ number: "512-555-0101", primary: true }],
    billingAddress: null,
    clientProperties: {
      nodes: [
        {
          id: gid("Property", 1),
          address: {
            street1: "1 Sample St",
            street2: "",
            city: "Austin",
            province: "TX",
            postalCode: "78701",
          },
        },
      ],
      totalCount: 2,
    },
  },
  {
    id: gid("Client", 102),
    firstName: "",
    lastName: "",
    companyName: "Example Offices LLC",
    isCompany: true,
    isLead: true,
    isArchived: false,
    emails: [],
    phones: [],
    billingAddress: {
      street1: "9 Demo Ave",
      street2: null,
      city: "Austin",
      province: "TX",
      postalCode: "78702",
    },
    clientProperties: { nodes: [], totalCount: 0 },
  },
  {
    id: gid("Client", 103),
    firstName: "Old",
    lastName: "Record",
    isArchived: true,
    emails: [],
    phones: [],
    clientProperties: { nodes: [] },
  },
];

/** Runs what is due now and what that schedules, without reaching the read's deletion a day later. */
async function settle(t: T) {
  for (let i = 0; i < 4; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

async function connectJobber(
  t: T,
  as: ReturnType<T["withIdentity"]>,
  companyId: Id<"companies">,
) {
  const { url } = await as.mutation(api.connectors.startJobber, { companyId });
  const state = new URL(url).searchParams.get("state")!;
  const response = await t.fetch(
    `/oauth/jobber/callback?state=${encodeURIComponent(state)}&code=auth-code`,
    { method: "GET" },
  );
  return { url, state, location: response.headers.get("location") ?? "" };
}

describe("the pure parts", () => {
  it("turns Jobber's encoded ids into the client number its exports show", () => {
    expect(jobberNumber(gid("Client", 29))).toBe("29");
    expect(jobberNumber("not-encoded!")).toBe("not-encoded!");
  });

  it("maps a Jobber client to an import row, preferring the first property's address", () => {
    const row = clientRow(CLIENTS[0] as never, undefined);
    expect(row).toMatchObject({
      name: "Avery Test",
      type: "person",
      email: "avery@example.test",
      phone: "512-555-0101",
      line1: "1 Sample St",
      city: "Austin",
      region: "TX",
      postalCode: "78701",
      externalId: "101",
    });
    expect(row.notes).toBe("Has 1 more property in Jobber.");
    const business = clientRow(CLIENTS[1] as never, undefined);
    expect(business).toMatchObject({
      name: "Example Offices LLC",
      type: "business",
      line1: "9 Demo Ave",
    });
    expect(business.notes).toMatch(/lead in Jobber/);
  });

  it("maps a Housecall Pro customer, using the service address, and checks the shape of a key", () => {
    const row = customerRow(
      {
        id: "cus_1",
        first_name: "Sam",
        last_name: "Sample",
        company: "Sample Rentals",
        mobile_number: "5125550199",
        addresses: [
          {
            type: "billing",
            street: "PO Box 1",
            city: "Austin",
            state: "TX",
            zip: "78701",
          },
          {
            type: "service",
            street: "5 Example Rd",
            city: "Austin",
            state: "TX",
            zip: "78703",
          },
        ],
      },
      undefined,
    );
    expect(row).toMatchObject({
      name: "Sam Sample",
      phone: "5125550199",
      line1: "5 Example Rd",
      postalCode: "78703",
      externalId: "cus_1",
    });
    expect(keyProblem("short")).toMatch(/too short/);
    expect(keyProblem("has spaces in it and more")).toMatch(
      /doesn't look like/,
    );
    expect(keyProblem(HCP_KEY)).toBeNull();
  });

  it("writes upcoming visits as a schedule note that says nothing is booked", () => {
    const base = Date.UTC(2026, 10, 24, 15);
    const note = scheduleNote(
      "Jobber",
      [
        base,
        base + 7 * 86_400_000,
        base + 14 * 86_400_000,
        base + 21 * 86_400_000,
      ],
      "America/Chicago",
    )!;
    expect(note).toMatch(/^Upcoming in Jobber: Tue, Nov 24, 9:00 AM; /);
    expect(note).toMatch(/and 1 more\. Not booked in Selestial\.$/);
    expect(scheduleNote("Jobber", [], "America/Chicago")).toBeUndefined();
  });
});

describe("Jobber", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers();
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    t = start();
  });
  afterEach(() => {
    setConnectorFetchForTests(null);
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("says Jobber is not available until the app is registered, and only the Owner may connect", async () => {
    vi.stubEnv("JOBBER_CLIENT_ID", "");
    const { as, companyId } = await company(t, "owner", "Alpha");
    expect(
      (await as.query(api.connectors.status, { companyId })).jobber.available,
    ).toBe(false);
    expect(
      await refusal(as.mutation(api.connectors.startJobber, { companyId })),
    ).toMatch(/isn’t available yet/);
    vi.stubEnv("JOBBER_CLIENT_ID", ENV.JOBBER_CLIENT_ID);
    expect(
      (await as.query(api.connectors.status, { companyId })).jobber.available,
    ).toBe(true);
    const manager = await addMember(t, as, companyId, "manager", "manager");
    await refusal(manager.mutation(api.connectors.startJobber, { companyId }));
  });

  it("connects, keeps Jobber's rotated token sealed, reads clients and visits without writing to Jobber, and imports through the usual path", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    const calls = fakeJobber({
      clients: CLIENTS,
      visits: [
        {
          id: gid("Visit", 1),
          startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          client: { id: gid("Client", 101) },
        },
        {
          id: gid("Visit", 2),
          startAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
          client: { id: gid("Client", 101) },
        },
      ],
    });
    const { url, location } = await connectJobber(t, as, companyId);
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://api.getjobber.com/api/oauth/authorize",
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://deployment.convex.site.test/oauth/jobber/callback",
    );
    expect(location).toBe(
      "https://app.selestial.test/app/setup?connector=jobber&result=connected",
    );
    await settle(t);

    const status = await as.query(api.connectors.status, { companyId });
    expect(status.jobber.connection).toMatchObject({
      status: "connected",
      account: "Test Cleaning Co",
    });
    expect(status.read).toMatchObject({
      system: "jobber",
      status: "ready",
      clients: 2,
      visits: 2,
      truncated: false,
    });

    // The stored credential is the rotated refresh token, sealed to the connection, never the plain text.
    const stored = await t.run(async (ctx) => {
      const connection = (
        await ctx.db.query("connectorConnections").collect()
      )[0];
      const credentials = await ctx.db.query("connectorCredentials").collect();
      return {
        connectionId: connection._id,
        credentials: credentials.map((c) => c.sealed),
      };
    });
    expect(stored.credentials).toHaveLength(1);
    expect(stored.credentials[0]).not.toContain("refresh-");
    expect(await unseal(stored.credentials[0], stored.connectionId)).toBe(
      "refresh-2",
    );

    // Only sign-in and read-only queries went to Jobber.
    for (const call of calls) {
      expect(call.method).toBe("POST");
      if (call.url.endsWith("/graphql")) {
        expect(
          (JSON.parse(call.body) as { query: string }).query.trim(),
        ).toMatch(/^query /);
        expect(call.auth).toBe("Bearer access-2");
      }
    }

    const { rows, system } = await as.query(api.connectors.readRows, {
      companyId,
      readId: status.read!.id,
    });
    expect(system).toBe("jobber");
    expect(rows.map((row) => row.name)).toEqual([
      "Avery Test",
      "Example Offices LLC",
    ]);
    expect(rows[0].schedule).toMatch(
      /^Upcoming in Jobber: .* Not booked in Selestial\.$/,
    );

    const first = await as.mutation(api.clientImports.commit, {
      companyId,
      importKey: `read:${status.read!.id}:0`,
      source: "jobber",
      label: "Jobber",
      rows: rows.map((row, index) => ({ index, row })),
      addAnyway: [],
      skip: [],
    });
    expect(first.created).toBe(2);
    // Reading again and importing again finds both clients instead of adding them twice.
    await as.mutation(api.connectors.read, { companyId, system: "jobber" });
    await settle(t);
    const again = await as.query(api.connectors.status, { companyId });
    const second = await as.mutation(api.clientImports.commit, {
      companyId,
      importKey: `read:${again.read!.id}:0`,
      source: "jobber",
      label: "Jobber",
      rows: (
        await as.query(api.connectors.readRows, {
          companyId,
          readId: again.read!.id,
        })
      ).rows.map((row, index) => ({ index, row })),
      addAnyway: [],
      skip: [],
    });
    expect(second.created).toBe(0);
    expect(
      second.results.every(
        (row) => row.reason === "Already imported from this system.",
      ),
    ).toBe(true);
    // No booking was made from a visit, and no permission to contact anyone was recorded.
    const written = await t.run(async (ctx) => ({
      jobs: (await ctx.db.query("jobs").collect()).length,
      customers: await ctx.db.query("customers").collect(),
    }));
    expect(written.jobs).toBe(0);
    expect(written.customers.every((c) => c.source === "import:jobber")).toBe(
      true,
    );
  });

  it("recognizes a client imported earlier from a Jobber spreadsheet by its client number", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    await as.mutation(api.clientImports.commit, {
      companyId,
      importKey: "file:0",
      source: "jobber",
      label: "export.csv",
      rows: [{ index: 0, row: { name: "Avery Test", externalId: "101" } }],
      addAnyway: [],
      skip: [],
    });
    fakeJobber({ clients: [CLIENTS[0]] });
    await connectJobber(t, as, companyId);
    await settle(t);
    const status = await as.query(api.connectors.status, { companyId });
    const checked = await as.query(api.clientImports.check, {
      companyId,
      source: "jobber",
      rows: (
        await as.query(api.connectors.readRows, {
          companyId,
          readId: status.read!.id,
        })
      ).rows,
    });
    expect(checked.rows[0].importedBefore).toBe(true);
    expect(checked.willCreate).toBe(0);
  });

  it("uses a sign-in state once, for ten minutes, and only for someone still the Owner", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    fakeJobber();
    const first = await connectJobber(t, as, companyId);
    const reused = await t.fetch(
      `/oauth/jobber/callback?state=${encodeURIComponent(first.state)}&code=auth-code`,
      { method: "GET" },
    );
    expect(reused.headers.get("location")).toMatch(/result=expired$/);
    const { url } = await as.mutation(api.connectors.startJobber, {
      companyId,
    });
    vi.advanceTimersByTime(11 * 60 * 1000);
    const late = await t.fetch(
      `/oauth/jobber/callback?state=${encodeURIComponent(new URL(url).searchParams.get("state")!)}&code=auth-code`,
      { method: "GET" },
    );
    expect(late.headers.get("location")).toMatch(/result=expired$/);
    const declined = await as.mutation(api.connectors.startJobber, {
      companyId,
    });
    const no = await t.fetch(
      `/oauth/jobber/callback?state=${encodeURIComponent(new URL(declined.url).searchParams.get("state")!)}&error=access_denied`,
      { method: "GET" },
    );
    expect(no.headers.get("location")).toMatch(/result=declined$/);
  });

  it("when Jobber ends the authorization, the read fails plainly and the credential is removed", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    fakeJobber({ refresh: "rejected" });
    await connectJobber(t, as, companyId);
    await settle(t);
    const status = await as.query(api.connectors.status, { companyId });
    expect(status.read).toMatchObject({
      status: "failed",
      problem: "Jobber ended this connection. Connect Jobber again.",
    });
    expect(status.jobber.connection).toMatchObject({ status: "expired" });
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("connectorCredentials").collect()).length,
      ),
    ).toBe(0);
    await refusal(
      as.mutation(api.connectors.read, { companyId, system: "jobber" }),
    );
  });

  it("keeps a read to its own company, and forgets it after a day", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    const other = await company(t, "owner-b", "Beta");
    fakeJobber({ clients: CLIENTS });
    await connectJobber(t, as, companyId);
    await settle(t);
    const readId = (await as.query(api.connectors.status, { companyId })).read!
      .id;
    await refusal(
      other.as.query(api.connectors.readRows, {
        companyId: other.companyId,
        readId,
      }),
    );
    expect(
      (
        await other.as.query(api.connectors.status, {
          companyId: other.companyId,
        })
      ).read,
    ).toBeNull();
    const office = await addMember(t, as, companyId, "office", "office");
    await refusal(office.query(api.connectors.readRows, { companyId, readId }));
    await t.mutation(internal.connectors.forget, { readId });
    expect(
      (await as.query(api.connectors.status, { companyId })).read,
    ).toBeNull();
  });
});

describe("Housecall Pro", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers();
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    t = start();
  });
  afterEach(() => {
    setConnectorFetchForTests(null);
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function fakeHousecall(accepts: boolean) {
    const calls: Call[] = [];
    setConnectorFetchForTests(async (url, init) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: "",
        auth: new Headers(init.headers).get("Authorization"),
      });
      if (!accepts) return json({ error: "Invalid API token" }, 401);
      const path = new URL(url).pathname;
      if (path === "/company") return json({ name: "Sample Home Services" });
      if (path === "/jobs")
        return json({
          jobs: [
            {
              id: "job_1",
              customer: { id: "cus_1" },
              schedule: {
                scheduled_start: new Date(
                  Date.now() + 2 * 86_400_000,
                ).toISOString(),
              },
              work_status: "scheduled",
            },
            {
              id: "job_2",
              customer: { id: "cus_1" },
              schedule: {
                scheduled_start: new Date(
                  Date.now() + 4 * 86_400_000,
                ).toISOString(),
              },
              work_status: "user canceled",
            },
          ],
          total_pages: 1,
        });
      if (path === "/customers")
        return json({
          customers: [
            {
              id: "cus_1",
              first_name: "Sam",
              last_name: "Sample",
              email: "sam@example.test",
              addresses: [
                {
                  type: "service",
                  street: "5 Example Rd",
                  city: "Austin",
                  state: "TX",
                  zip: "78703",
                },
              ],
            },
          ],
          total_pages: 1,
        });
      return json({}, 404);
    });
    return calls;
  }

  it("checks the key before counting it as connected, and a refused key is not kept", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    expect(
      await refusal(
        as.mutation(api.connectors.connectHousecall, {
          companyId,
          apiKey: "nope",
        }),
      ),
    ).toMatch(/too short/);
    fakeHousecall(false);
    await as.mutation(api.connectors.connectHousecall, {
      companyId,
      apiKey: HCP_KEY,
    });
    expect(
      (await as.query(api.connectors.status, { companyId })).housecall
        .connection,
    ).toMatchObject({ status: "checking" });
    await settle(t);
    expect(
      (await as.query(api.connectors.status, { companyId })).housecall
        .connection,
    ).toMatchObject({
      status: "expired",
      problem: expect.stringMatching(/didn't accept this API key/),
    });
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("connectorCredentials").collect()).length,
      ),
    ).toBe(0);
  });

  it("reads customers and upcoming jobs with GET requests only, then disconnecting deletes the key and the read", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    const calls = fakeHousecall(true);
    await as.mutation(api.connectors.connectHousecall, {
      companyId,
      apiKey: HCP_KEY,
    });
    await settle(t);
    const status = await as.query(api.connectors.status, { companyId });
    expect(status.housecall.connection).toMatchObject({
      status: "connected",
      account: "Sample Home Services",
    });
    expect(status.read).toMatchObject({
      system: "housecall_pro",
      status: "ready",
      clients: 1,
      visits: 1,
    });
    expect(
      calls.every(
        (call) =>
          call.method === "GET" &&
          call.auth === `Token ${HCP_KEY}` &&
          call.url.startsWith("https://api.housecallpro.com/"),
      ),
    ).toBe(true);
    const { rows } = await as.query(api.connectors.readRows, {
      companyId,
      readId: status.read!.id,
    });
    expect(rows[0]).toMatchObject({
      name: "Sam Sample",
      externalId: "cus_1",
      line1: "5 Example Rd",
    });
    expect(rows[0].schedule).toMatch(
      /^Upcoming in Housecall Pro: [^;]+\. Not booked/,
    );
    // The key never comes back to a browser.
    expect(JSON.stringify(status)).not.toContain(HCP_KEY);

    await refusal(
      (await addMember(t, as, companyId, "manager", "manager")).mutation(
        api.connectors.disconnect,
        { companyId, system: "housecall_pro" },
      ),
    );
    await as.mutation(api.connectors.disconnect, {
      companyId,
      system: "housecall_pro",
    });
    const after = await as.query(api.connectors.status, { companyId });
    expect(after.housecall.connection).toBeNull();
    expect(after.read).toBeNull();
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("connectorCredentials").collect()).length,
      ),
    ).toBe(0);
  });
});
