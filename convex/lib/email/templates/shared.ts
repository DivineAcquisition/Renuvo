/**
 * What every template shares: the finished email's shape, where the images are served from, and how
 * dates and money are written. Pure, like the kit.
 */
import { oneLine, webAddress, type Footer } from "../kit";

/** A finished email: the subject and preheader the inbox shows, the HTML, and the same words as text. */
export type Email = { subject: string; preheader: string; html: string; text: string };

/** The backend agents and the face each one has (public/email/agents/<id>.png, made from public/agents). */
export const AGENT_FACES = {
  sales: { name: "Sales", image: "sales" },
  recruiter: { name: "Recruiter", image: "recruiter" },
  dispatch: { name: "Dispatch", image: "dispatch" },
  retention: { name: "Retention", image: "retention" },
} as const;
export type AgentId = keyof typeof AGENT_FACES;

/**
 * Image addresses for an email, from the app's own address. Email needs absolute addresses and PNG
 * (Outlook doesn't show WebP). With no address, the images are left out and the text still reads.
 */
export function emailAssets(origin: string | null | undefined) {
  const base = webAddress(origin)?.replace(/\/+$/, "") ?? null;
  return {
    mark: base ? `${base}/email/selestial-mark.png` : null,
    agent: (agent: AgentId) => (base ? `${base}/email/agents/${AGENT_FACES[agent].image}.png` : null),
  };
}

/** A page of the app, from its address. Null when there's no address, so no link is ever guessed. */
export function appLink(origin: string | null | undefined, path: string): string | null {
  const base = webAddress(origin)?.replace(/\/+$/, "");
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : null;
}

function inZone<T>(timezone: string | undefined, format: (zone: string) => T): T {
  try {
    return format(timezone?.trim() || "UTC");
  } catch {
    return format("UTC");
  }
}

/** "Tuesday, November 18 at 9:30 AM" on the company's clock. */
export function when(at: number, timezone?: string): string {
  return inZone(timezone, (timeZone) => {
    const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(new Date(at));
    const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
    return `${day} at ${time}`;
  });
}

/** "9:30 AM" on the company's clock. */
export function timeOf(at: number, timezone?: string): string {
  return inZone(timezone, (timeZone) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at)));
}

/** "November 18, 2026" on the company's clock. */
export function dayOf(at: number, timezone?: string): string {
  return inZone(timezone, (timeZone) => new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long" }).format(new Date(at)));
}

/** "Nov 18" on the company's clock. */
export function shortDay(at: number, timezone?: string): string {
  return inZone(timezone, (timeZone) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(at)));
}

/** "$1,240.00". */
export function money(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/** "1 visit", "3 visits". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Sales, Hiring and Operations". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function firstName(name: string | null | undefined): string | null {
  const first = oneLine(name ?? "").split(" ")[0];
  return first || null;
}

export const ROLE_WORDS = { owner: "the Owner", manager: "a Manager", office: "an Office member" } as const;
export type MemberRole = keyof typeof ROLE_WORDS;

/** The footer of a notification to a member: why they got it and where to change it. */
export function memberFooter(input: { origin?: string | null; companyName: string; role: MemberRole; because?: string; essential?: boolean; unsubscribeUrl?: string | null }): Footer {
  const company = oneLine(input.companyName);
  const reason = input.essential
    ? `You're getting this because you're ${ROLE_WORDS[input.role]} of ${company}. Security and account notices are always sent.`
    : `You're getting this because you're ${ROLE_WORDS[input.role]} of ${company}${input.because ? ` and ${input.because}` : ""}.`;
  // Security and account notices never carry an unsubscribe link, whatever is passed.
  return { reason, preferencesUrl: appLink(input.origin, "/app/settings/notifications"), unsubscribeUrl: input.essential ? null : (input.unsubscribeUrl ?? null) };
}
