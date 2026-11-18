/**
 * Who an email may be from (docs/email/00-architecture.md §3). Every From is built here, from the
 * deployment's own sender settings, which name addresses on domains Selestial verified with its mail
 * provider. Nothing a person types and nothing stored on a record becomes a From address; a company's
 * name only ever becomes the display name in front of a Selestial address.
 *
 *   NOTIFY_EMAIL_FROM     Selestial's notices to members        e.g. Selestial <notify@notify.selestial.io>
 *   COMPANY_EMAIL_FROM    mail sent for a company, via Selestial e.g. messages@mail.selestial.io
 *   EMAIL_FROM            the original sender; the fallback for both
 *   RECRUITER_EMAIL_FROM  the hiring sender; a fallback for company mail
 *   PLATFORM_REPLY_TO     optional: where replies to Selestial's notices go
 *
 * When a sender isn't configured, the answer says so in words and the message waits. It is never sent
 * from some other identity instead.
 */

const ADDRESS = /^[^\s@<>"(),;:]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** The address in a header like `Name <a@b.c>`, or the value itself when it's a bare address. Lower case. */
export function addressOf(header: string | undefined | null): string | null {
  const raw = (header ?? "").trim();
  const inside = raw.match(/<([^<>]+)>\s*$/)?.[1] ?? raw;
  const address = inside.trim().toLowerCase();
  return ADDRESS.test(address) ? address : null;
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * With the test double (EMAIL_PROVIDER=mock) nothing is really sent, so a deployment or a test with no
 * sender set still gets one, on the reserved .test domain. Real providers never get it.
 */
const MOCK_ADDRESS = "messages@mail.selestial.test";
const mock = () => env("EMAIL_PROVIDER")?.toLowerCase() === "mock";

/** The domains this deployment sends from: the domains of its own configured sender addresses. */
export function verifiedDomains(): string[] {
  const domains = new Set<string>();
  for (const name of ["EMAIL_FROM", "NOTIFY_EMAIL_FROM", "COMPANY_EMAIL_FROM", "RECRUITER_EMAIL_FROM"]) {
    const address = addressOf(env(name));
    if (address) domains.add(domainOf(address));
  }
  if (mock()) domains.add(domainOf(MOCK_ADDRESS));
  return [...domains];
}

/** True only for a From built from a configured sender: an address on one of this deployment's domains. */
export function isVerifiedFrom(from: string): boolean {
  const address = addressOf(from);
  return address !== null && verifiedDomains().includes(domainOf(address));
}

/** A display name that can't break the header: no quotes, angle brackets or line breaks, at most 78 characters. */
export function displayName(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 78);
}

function header(name: string, address: string): string {
  const clean = displayName(name);
  return clean ? `"${clean}" <${address}>` : address;
}

export type Sender = { ok: true; from: string; replyTo?: string } | { ok: false; words: string };

const NOT_SET = "Selestial's sending address for this kind of email isn't set up yet, so it's waiting.";

/** Selestial writing to the people who use it. */
export function platformSender(): Sender {
  const address = addressOf(env("NOTIFY_EMAIL_FROM")) ?? addressOf(env("EMAIL_FROM")) ?? (mock() ? MOCK_ADDRESS : null);
  if (!address) return { ok: false, words: NOT_SET };
  const replyTo = addressOf(env("PLATFORM_REPLY_TO")) ?? undefined;
  return { ok: true, from: header("Selestial", address), ...(replyTo ? { replyTo } : {}) };
}

/**
 * A company writing to its customers, applicants or cleaners through Selestial's shared sender: its
 * name, then "via Selestial", on Selestial's address. A company with no name to show waits.
 */
export function companySender(name: string | null | undefined): Sender {
  const address = addressOf(env("COMPANY_EMAIL_FROM")) ?? addressOf(env("RECRUITER_EMAIL_FROM")) ?? addressOf(env("EMAIL_FROM")) ?? (mock() ? MOCK_ADDRESS : null);
  if (!address) return { ok: false, words: NOT_SET };
  const clean = displayName(name ?? "");
  if (!clean) return { ok: false, words: "The company's name isn't set, so email can't say who it's from. Add it in Business details." };
  return { ok: true, from: header(/via selestial$/i.test(clean) ? clean : `${clean} via Selestial`, address) };
}
