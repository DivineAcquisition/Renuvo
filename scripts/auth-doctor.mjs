/**
 * Checks that a sign-in instance is set up the way Selestial's screens need, and says what is not.
 *
 *   node scripts/auth-doctor.mjs            read-only: prints each check
 *   node scripts/auth-doctor.mjs --fix      also does the two things the service's API allows:
 *                                           makes the record's token template, turns its organizations off
 *   ... --fix --live                        the same on a live instance, on purpose
 *
 * Reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY from the environment. Prints no secret.
 * The rest (which details sign-up asks for, how email is confirmed) can only be changed in the
 * sign-in service's dashboard; docs/foundation/03-authentication.md says where.
 */
import { templates } from "./auth-emails.mjs";

const API = "https://api.clerk.com/v1";
const fix = process.argv.includes("--fix");
const liveOk = process.argv.includes("--live");

/** The claims the record needs in its token. Without the email and its confirmed status, nobody can be invited. */
export const RECORD_TOKEN = { name: "convex", claims: { aud: "convex", name: "{{user.full_name}}", email: "{{user.primary_email_address}}", email_verified: "{{user.email_verified}}" }, lifetime: 60, allowed_clock_skew: 5 };

async function api(method, path, body) {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set.");
  const response = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${(json?.errors ?? []).map((row) => row.code).join(", ") || "no detail"}`);
  return json;
}

function frontend() {
  const encoded = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim().split("_")[2];
  if (!encoded) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set.");
  return `https://${Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "")}`;
}

const rows = [];
const say = (ok, what, how) => {
  rows.push(ok);
  console.log(`  ${ok ? "ok   " : "FIX  "} ${what}${ok || !how ? "" : `\n         ${how}`}`);
};

async function main() {
  const instance = await api("GET", "/instance");
  const live = instance.environment_type !== "development";
  if (fix && live && !liveOk) throw new Error("This is a live instance. Add --live to change it on purpose.");
  const base = frontend();
  console.log(`Sign-in instance: ${instance.environment_type}, at ${base}\n`);

  const settings = await (await fetch(`${base}/v1/environment`)).json();
  const attributes = settings.user_settings?.attributes ?? {};
  const on = (name) => attributes[name]?.enabled === true;
  const required = (name) => on(name) && attributes[name]?.required === true;

  say(required("email_address"), "Email is required to sign up", "Dashboard: User & authentication, Email: on and required.");
  say((attributes.email_address?.verifications ?? []).includes("email_code") && attributes.email_address?.verify_at_sign_up === true, "Email is confirmed at sign-up with a code", "Dashboard: User & authentication, Email: verify at sign-up, by verification code.");
  say(required("password"), "A password is required", "Dashboard: User & authentication, Password: on.");
  say(!required("phone_number"), "A phone number is not required to sign up", "Dashboard: User & authentication, Phone: off (or not required). Selestial's form does not ask for one.");
  say(!required("username"), "A username is not required to sign up", "Dashboard: User & authentication, Username: off. Selestial's form does not ask for one.");
  say(settings.user_settings?.sign_up?.mode !== "restricted" && settings.user_settings?.sign_up?.mode !== "waitlist", "Sign-up is open", "Dashboard: Restrictions, Sign-up mode: public.");

  let organizations = settings.organization_settings ?? {};
  if (organizations.enabled && organizations.force_organization_selection && fix) {
    await api("PATCH", "/instance/organization_settings", { enabled: false });
    organizations = { enabled: false };
    console.log("         turned the service's organizations off");
  }
  say(!(organizations.enabled && organizations.force_organization_selection), "Sessions are not held back by the service's own organizations feature", "Selestial keeps companies in its own record. Dashboard: Organizations: off, or membership optional. (--fix turns it off.)");

  let tokens = await api("GET", "/jwt_templates");
  let token = tokens.find((row) => row.name === RECORD_TOKEN.name);
  if (!token && fix) {
    token = await api("POST", "/jwt_templates", RECORD_TOKEN);
    console.log("         made the record's token template");
  }
  const claims = token?.claims ?? {};
  say(Boolean(token) && claims.aud === "convex" && Boolean(claims.email) && Boolean(claims.email_verified), `The "${RECORD_TOKEN.name}" token template exists and carries the email and its confirmed status`, `Dashboard: JWT templates, new template named "${RECORD_TOKEN.name}" with claims ${JSON.stringify(RECORD_TOKEN.claims)}. (--fix makes it.)`);

  const policy = settings.user_settings?.password_settings ?? {};
  console.log(`\n  Password rules in force: at least ${policy.min_length} characters${policy.disable_hibp === false ? ", breached passwords refused" : ""}. The forms read these; nothing to do.`);
  console.log(`  The record must trust this instance: on the Convex deployment, CLERK_JWT_ISSUER_DOMAIN = ${base}`);

  const app = process.env.APP_ORIGIN ?? "https://app.example.test";
  let branded = 0;
  const set = templates(app);
  for (const template of set) {
    const current = await api("GET", `/templates/email/${template.slug}`);
    if (/SELESTIAL/.test(current.body ?? "") && !/clerk/i.test(current.body ?? "")) branded += 1;
  }
  console.log("");
  say(branded === set.length, `The sign-in emails are Selestial's (${branded} of ${set.length})`, "Run: node scripts/auth-emails.mjs --apply --app-origin <the workspace's address>");

  const failed = rows.filter((ok) => !ok).length;
  console.log(failed === 0 ? "\nReady." : `\n${failed} thing${failed === 1 ? "" : "s"} to fix.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
