/**
 * Reading hiring mail: the shapes a mailbox connector hands over, and what code alone can tell from a
 * sender and a subject.
 *
 * UNVERIFIED: the sender domains and subject wording for Indeed and ZipRecruiter below come from the
 * Novara reference (Indeed only) and from general knowledge of these notices, not from real samples.
 * They are data in one place (BOARDS) so they can be corrected against redacted examples without
 * touching the workflow. docs/recruiter/05-assumptions.md lists each one.
 *
 * Everything in a message is untrusted. It is parsed as text, capped, and shown to people. Nothing in
 * it is ever treated as an instruction, and no value from it reaches a setting or a permission.
 */
import type { Classification, Source } from "./schema";

/** What Recruiter may see of any message before deciding whether to open it. */
export type MessageHeader = {
  id: string;
  threadId?: string;
  /** As the provider gives it: `Name <address>` or a bare address. */
  from: string;
  replyTo?: string;
  subject: string;
  receivedAt: number;
};

export type MessageAttachment = { name: string; contentType: string; size: number; /** Text the connector could read from it, if any. */ text?: string };

export type MessageBody = MessageHeader & { text: string; attachments: MessageAttachment[] };

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
export const MAX_TEXT = 20_000;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The address inside `Name <address>`, lower case, or null. */
export function addressOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const found = raw.match(ADDRESS);
  return found ? normalizeEmail(found[found.length - 1]) : null;
}

export function addressesIn(text: string): string[] {
  return [...new Set((text.match(ADDRESS) ?? []).map(normalizeEmail))];
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

/** Digits with a country code, or null when it is not a phone number. */
export function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Plain text from whatever a message held: tags and control characters removed, length capped. */
export function plainText(value: string, max = MAX_TEXT): string {
  return value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]{0,500}>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** One line of text for a record: no line breaks, capped. */
export function oneLine(value: string, max = 200): string {
  return plainText(value, max * 4).replace(/\s+/g, " ").trim().slice(0, max);
}

const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|alerts?|mailer-daemon|postmaster|info|support|jobs|team|hello|news|marketing)(\+|$)/;

/** An address that only sends notices: nobody reads what is sent to it. */
export function isNotificationAddress(address: string): boolean {
  return NO_REPLY.test(address.slice(0, address.lastIndexOf("@")));
}

type Board = {
  source: Exclude<Source, "direct" | "manual" | "other">;
  /** Mail from these domains (or their subdomains) is this board's. */
  domains: string[];
  /** Domains whose per-candidate addresses forward to the applicant. Behaviour and limits are unverified. */
  relayDomains: string[];
  /** Tried in order. The first that matches the subject decides. */
  subjects: { pattern: RegExp; classification: Classification }[];
};

export const BOARDS: readonly Board[] = [
  {
    source: "indeed",
    domains: ["indeed.com", "indeedemail.com"],
    relayDomains: ["indeedemail.com"],
    subjects: [
      { pattern: /\b(candidates? you might|recommended candidates?|matched candidates?|invite .* to apply|people who match)\b/i, classification: "suggested_candidate" },
      { pattern: /\bnew message from\b|\bsent you a message\b|\breplied\b/i, classification: "applicant_reply" },
      { pattern: /\binterview\b|\bstatus\b|\bwithdr[ae]w/i, classification: "status_update" },
      { pattern: /\bnew application\b|\bapplied (to|for)\b|\bnew applicant\b/i, classification: "new_application" },
    ],
  },
  {
    source: "ziprecruiter",
    domains: ["ziprecruiter.com"],
    relayDomains: ["reply.ziprecruiter.com"],
    subjects: [
      { pattern: /\b(great match|recommended|candidates? for you|invite .* to apply|suggested candidates?|potential candidates?)\b/i, classification: "suggested_candidate" },
      { pattern: /\bmessage from\b|\breplied\b/i, classification: "applicant_reply" },
      { pattern: /\binterview\b|\bstatus\b|\bwithdr[ae]w/i, classification: "status_update" },
      { pattern: /\bnew candidate\b|\bnew applicant\b|\bnew application\b|\bapplied (to|for)\b/i, classification: "new_application" },
    ],
  },
];

function under(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

export function boardFor(address: string | null): Board | null {
  if (!address) return null;
  const domain = domainOf(address);
  return BOARDS.find((board) => board.domains.some((parent) => under(domain, parent))) ?? null;
}

/** True for a board address that is one applicant's forwarding address, not the board's own mailbox. */
export function isRelayAddress(address: string): boolean {
  const board = boardFor(address);
  if (!board || isNotificationAddress(address)) return false;
  return board.relayDomains.some((parent) => under(domainOf(address), parent));
}

export type HeaderVerdict =
  /** A job board's notice. Code decided; the body is needed only for the kinds worth reading. */
  | { kind: "board"; source: Board["source"]; classification: Classification; reason: string }
  /** Not from a board Recruiter knows. Someone has to look at the sender and subject. */
  | { kind: "unknown" };

/** What the sender and subject alone say. No body is read to answer this. */
export function classifyHeader(header: MessageHeader): HeaderVerdict {
  const board = boardFor(addressOf(header.from));
  if (!board) return { kind: "unknown" };
  const match = board.subjects.find((entry) => entry.pattern.test(header.subject));
  if (!match) return { kind: "board", source: board.source, classification: "promotion", reason: "From a job board, and the subject is not about a person who applied." };
  return { kind: "board", source: board.source, classification: match.classification, reason: `From ${board.source}; the subject reads as ${match.classification.replace(/_/g, " ")}.` };
}

/** The kinds of message whose body Recruiter opens. Promotions and suggested candidates are never opened. */
export function worthReading(classification: Classification): boolean {
  return classification === "new_application" || classification === "applicant_reply" || classification === "status_update" || classification === "duplicate_notification";
}

export function isForwarded(subject: string): boolean {
  return /^\s*(fwd?|fw)\s*:/i.test(subject);
}
