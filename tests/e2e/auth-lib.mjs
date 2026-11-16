/**
 * Helpers for the sign-in browser run (tests/e2e/auth.mjs).
 *
 * Runs against a DEVELOPMENT sign-in instance only. Test people use addresses ending "+clerk_test@example.com":
 * the sign-in service sends them no email and accepts the fixed code 424242. Nothing reaches a real inbox.
 * The service's secret key is read from CLERK_SECRET_KEY and is never printed.
 */
export const CODE = "424242";
export const BASE = process.env.AUTH_E2E_BASE ?? "http://localhost:3200";
const API = "https://api.clerk.com/v1";

function headers() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set.");
  if (key.startsWith("sk_live_")) throw new Error("Refusing to run against a live sign-in instance.");
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

export async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${(json?.errors ?? []).map((row) => row.code).join(",")}`);
  return json;
}

/** Stops at once unless the instance is a development one. */
export async function assertDevelopment() {
  const instance = await api("GET", "/instance");
  if (instance.environment_type !== "development") throw new Error("The sign-in instance is not a development instance.");
}

let serial = 0;
/** Makes a test person directly in the sign-in service, for flows that start with an existing account. */
export async function makePerson(run, label, password, name) {
  serial += 1;
  const email = `sel-${label}-${run}+clerk_test@example.com`;
  const [first_name, ...rest] = name.split(" ");
  // Test people stand for someone who signed up, so they carry the agreement the sign-up form records.
  const base = { email_address: [email], password, first_name, last_name: rest.join(" "), skip_password_checks: false, legal_accepted_at: new Date().toISOString() };
  let user;
  try {
    user = await api("POST", "/users", base);
  } catch (error) {
    // Some instances also require a username and a phone number. Test numbers in the 555-01xx range receive no text.
    if (!/form_param_missing|form_data_missing|missing/.test(String(error.message))) throw error;
    user = await api("POST", "/users", { ...base, username: `sel_${label}_${run}`.slice(0, 40), phone_number: [`+1555555${String(100 + ((Number.parseInt(run.slice(-4), 36) + serial) % 100)).padStart(4, "0")}`] });
  }
  return { id: user.id, email, password, name };
}

export async function removePerson(id) {
  await api("DELETE", `/users/${id}`).catch(() => undefined);
}

/**
 * The sign-in service checks that a browser is not a bot before it lets an account be made. A scripted
 * browser cannot pass that check, so the service issues a short-lived testing token for development
 * instances. Adding it to the browser's requests to the service is its supported way to test.
 */
export async function passBotCheck(context) {
  const { token } = await api("POST", "/testing_tokens");
  const domains = await api("GET", "/domains");
  const host = new URL(domains.data[0].frontend_api_url).host;
  await context.route(`https://${host}/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("__clerk_testing_token", token);
    await route.continue({ url: url.toString() });
  });
}

export async function activeSessions(userId) {
  const rows = await api("GET", `/sessions?user_id=${userId}&status=active`);
  return Array.isArray(rows) ? rows : (rows?.data ?? []);
}

/** A list of checks with a printed result, so a run reads as a report. */
export function reporter(onFail) {
  const rows = [];
  return {
    async check(name, work) {
      const started = Date.now();
      try {
        await work();
        rows.push({ name, ok: true });
        console.log(`  ok    ${name} (${Date.now() - started} ms)`);
      } catch (error) {
        rows.push({ name, ok: false, error: String(error?.message ?? error).split("\n")[0].slice(0, 300) });
        console.log(`  FAIL  ${name}\n        ${rows[rows.length - 1].error}`);
        await onFail?.(rows.filter((row) => row.ok === false).length).catch(() => undefined);
      }
    },
    skip(name, why) {
      rows.push({ name, ok: null, error: why });
      console.log(`  skip  ${name}: ${why}`);
    },
    done() {
      const failed = rows.filter((row) => row.ok === false).length;
      const skipped = rows.filter((row) => row.ok === null).length;
      console.log(`\n${rows.filter((row) => row.ok).length} passed, ${failed} failed, ${skipped} skipped`);
      return failed;
    },
  };
}

export function expect(condition, message) {
  if (!condition) throw new Error(message);
}
