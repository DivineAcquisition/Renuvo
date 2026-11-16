/**
 * The sign-in emails, in Selestial's own words and layout, and the command that installs them on the
 * sign-in service. The service sends these itself (confirmation codes, reset codes, security notices),
 * so branding them means replacing its templates. The invitation email is different: Selestial sends
 * that one from the record (convex/lib/email/invitation.ts). Both use the same frame.
 *
 *   node scripts/auth-emails.mjs --check                     compare the service's templates with these
 *   node scripts/auth-emails.mjs --preview <directory>       write each email as an .html and a .txt file
 *   node scripts/auth-emails.mjs --apply --app-origin <url>  install them (development instance)
 *   ... --apply --live                                       install them on a live instance, on purpose
 *
 * Reads CLERK_SECRET_KEY from the environment and never prints it. Words in {{double braces}} are
 * filled in by the service when it sends. No email states how long a code lasts: that is the
 * service's setting, and a number written here could drift from it.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { BRAND, emailLayout, emailText, escapeHtml } from "../convex/lib/email/layout.ts";

const API = "https://api.clerk.com/v1";
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function origin(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.origin : null;
  } catch {
    return null;
  }
}

const paragraph = (text) => `<p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:${BRAND.text};">${text}</p>`;
const quiet = (text) => `<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:${BRAND.secondary};">${text}</p>`;
/** The code, large and easy to read aloud or copy. It is text, so it works with images turned off. */
const code = (variable) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="padding:14px 22px;border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.page};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;line-height:36px;letter-spacing:8px;font-weight:700;color:${BRAND.text};">${variable}</td></tr></table>`;
const detail = (label, variable) => `<tr><td style="padding:4px 16px 4px 0;font-size:13px;line-height:20px;color:${BRAND.secondary};white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:13px;line-height:20px;color:${BRAND.text};">${variable}</td></tr>`;
const details = (rows) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${rows.join("")}</table>`;

/** Every sign-in email Selestial brands. `app` is the workspace's address, for the links back into it. */
export function templates(app) {
  const security = app ? { label: "Review my security settings", url: `${app}/app/settings#security` } : undefined;
  const reset = app ? { label: "Reset my password", url: `${app}/forgot-password` } : undefined;
  const unexpected = "If this was not you, you can ignore this email. Someone may have typed your address by mistake, and nothing changes unless the code is used.";
  return [
    {
      slug: "verification_code",
      name: "Verification code",
      subject: "{{otp_code}} is your Selestial code",
      html: emailLayout({
        preheader: "Your Selestial confirmation code.",
        heading: "Confirm it is you",
        bodyHtml: paragraph("Enter this code in Selestial to confirm your email address:") + code("{{otp_code}}") + quiet("The code works once. Only type it into Selestial; nobody from Selestial will ask you for it."),
        footnote: unexpected,
      }),
      text: emailText({ heading: "Confirm it is you", lines: ["Enter this code in Selestial to confirm your email address:", "", "{{otp_code}}", "", "The code works once. Only type it into Selestial; nobody from Selestial will ask you for it."], footnote: unexpected }),
    },
    {
      slug: "reset_password_code",
      name: "Reset password code",
      subject: "{{otp_code}} is your Selestial password reset code",
      html: emailLayout({
        preheader: "Your Selestial password reset code.",
        heading: "Reset your password",
        bodyHtml: paragraph("Someone asked to reset the password for this Selestial account. Enter this code on the reset page to choose a new password:") + code("{{otp_code}}") + quiet("The code works once, and only in the browser where the reset was requested."),
        footnote: "If you did not ask for this, you can ignore this email. Your password has not changed.",
      }),
      text: emailText({ heading: "Reset your password", lines: ["Someone asked to reset the password for this Selestial account. Enter this code on the reset page to choose a new password:", "", "{{otp_code}}", "", "The code works once, and only in the browser where the reset was requested."], footnote: "If you did not ask for this, you can ignore this email. Your password has not changed." }),
    },
    {
      slug: "password_changed",
      name: "Password changed",
      subject: "Your Selestial password was changed",
      html: emailLayout({
        preheader: "The password for your Selestial account was changed.",
        heading: "Your password was changed",
        bodyHtml: paragraph("The password for the Selestial account <strong>{{primary_email_address}}</strong> was just changed.") + quiet("If you made this change, there is nothing more to do."),
        action: reset,
        footnote: "If you did not change your password, reset it now and then review where your account is signed in.",
      }),
      text: emailText({ heading: "Your password was changed", lines: ["The password for the Selestial account {{primary_email_address}} was just changed.", "If you made this change, there is nothing more to do."], action: reset, footnote: "If you did not change your password, reset it now and then review where your account is signed in." }),
    },
    {
      slug: "primary_email_address_changed",
      name: "Primary email address changed",
      subject: "Your Selestial sign-in email was changed",
      html: emailLayout({
        preheader: "The sign-in email for your Selestial account was changed.",
        heading: "Your sign-in email was changed",
        bodyHtml: paragraph("The sign-in email for your Selestial account is now <strong>{{new_email_address}}</strong>.") + quiet("If you made this change, there is nothing more to do."),
        action: security,
        footnote: "If you did not make this change, sign in and review your security settings, or reset your password if you can no longer sign in.",
      }),
      text: emailText({ heading: "Your sign-in email was changed", lines: ["The sign-in email for your Selestial account is now {{new_email_address}}.", "If you made this change, there is nothing more to do."], action: security, footnote: "If you did not make this change, sign in and review your security settings, or reset your password if you can no longer sign in." }),
    },
    {
      slug: "new_device_sign_in",
      name: "Sign in from new device",
      subject: "New sign-in to your Selestial account",
      html: emailLayout({
        preheader: "Your Selestial account was signed in to from a new device.",
        heading: "New sign-in to your account",
        bodyHtml:
          paragraph("Your Selestial account was just signed in to from a device that has not been used before.") +
          details([detail("When", "{{session_created_at}}"), detail("Device", "{{device_type}}, {{operating_system}}"), detail("Browser", "{{browser_name}}"), detail("Location", "{{location}}"), detail("IP address", "{{ip_address}}")]) +
          quiet("If this was you, there is nothing more to do."),
        action: security,
        footnote: "If this was not you, reset your password, then sign out your other sessions from Settings, Security.",
      }),
      text: emailText({
        heading: "New sign-in to your account",
        lines: ["Your Selestial account was just signed in to from a device that has not been used before.", "", "When: {{session_created_at}}", "Device: {{device_type}}, {{operating_system}}", "Browser: {{browser_name}}", "Location: {{location}}", "IP address: {{ip_address}}", "", "If this was you, there is nothing more to do."],
        action: security,
        footnote: "If this was not you, reset your password, then sign out your other sessions from Settings, Security.",
      }),
    },
    {
      slug: "account_locked",
      name: "Account Locked",
      subject: "Your Selestial account is locked for now",
      html: emailLayout({
        preheader: "Too many failed sign-in attempts locked your Selestial account for a while.",
        heading: "Your account is locked for now",
        bodyHtml: paragraph("After {{failed_attempts}} failed sign-in attempts, your Selestial account was locked to keep it safe.") + details([detail("Locked", "{{locked_date}}"), detail("Unlocks", "{{unlock_time}}")]) + quiet("You do not need to do anything. After it unlocks you can sign in as usual."),
        action: reset,
        footnote: "If those attempts were not you, reset your password once the account unlocks.",
      }),
      text: emailText({ heading: "Your account is locked for now", lines: ["After {{failed_attempts}} failed sign-in attempts, your Selestial account was locked to keep it safe.", "", "Locked: {{locked_date}}", "Unlocks: {{unlock_time}}", "", "You do not need to do anything. After it unlocks you can sign in as usual."], action: reset, footnote: "If those attempts were not you, reset your password once the account unlocks." }),
    },
  ];
}

async function api(method, path, body) {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set.");
  const response = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${(json?.errors ?? []).map((row) => row.code).join(", ") || "no detail"}`);
  return json;
}

async function main() {
  const app = origin(value("--app-origin") ?? process.env.APP_ORIGIN);
  const set = templates(app);

  if (flag("--preview")) {
    const directory = value("--preview");
    if (!directory) throw new Error("--preview needs a directory.");
    mkdirSync(directory, { recursive: true });
    for (const template of set) {
      writeFileSync(`${directory}/${template.slug}.html`, template.html);
      writeFileSync(`${directory}/${template.slug}.txt`, `Subject: ${template.subject}\n\n${template.text}\n`);
    }
    console.log(`Wrote ${set.length} emails to ${directory}.${app ? "" : " No --app-origin was given, so the emails have no buttons."}`);
    return;
  }

  const instance = await api("GET", "/instance");
  const live = instance.environment_type !== "development";
  console.log(`Sign-in instance: ${instance.environment_type}.`);

  if (flag("--apply")) {
    if (live && !flag("--live")) throw new Error("This is a live instance. Add --live to install the emails on it on purpose.");
    if (!app) throw new Error("--apply needs --app-origin (or APP_ORIGIN), the workspace's address, for the links in the emails.");
    for (const template of set) {
      const current = await api("GET", `/templates/email/${template.slug}`);
      // The service keeps a second, editor-only form of each email ("markup"). It is sent back unchanged.
      await api("PUT", `/templates/email/${template.slug}`, { name: current.name ?? template.name, subject: template.subject, markup: current.markup ?? "", body: template.html, delivered_by_clerk: current.delivered_by_clerk ?? true });
      console.log(`  installed  ${template.slug}`);
    }
    return;
  }

  let different = 0;
  for (const template of set) {
    const current = await api("GET", `/templates/email/${template.slug}`);
    const same = current.subject?.trim() === template.subject && current.body === template.html;
    if (!same) different += 1;
    console.log(`  ${same ? "matches  " : "differs  "} ${template.slug}${current.enabled === false ? " (turned off on the service)" : ""}`);
  }
  console.log(different === 0 ? "Every sign-in email is Selestial's." : `${different} of ${set.length} are not Selestial's yet. Run with --apply to install them.`);
  if (different > 0 && flag("--strict")) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  });
}
