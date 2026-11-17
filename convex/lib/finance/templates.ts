/**
 * The words of the invoice and reminder messages Selestial prepares. Written by code from the record,
 * never by a model, so every amount and date in them is the one on the invoice. The pay link is
 * "{link}": it is made at the moment the message is sent, so a voided invoice never sends a live link.
 *
 * The Owner may edit any draft before approving it. These are the starting words.
 */
import type { Doc } from "../../_generated/dataModel";
import { dollars } from "./money";
import type { FinanceMessageStage } from "./schema";

export type TemplateInput = {
  company: string;
  customer: string;
  invoice: Pick<Doc<"invoices">, "number" | "memo">;
  /** What the pay page asks for right now. */
  requestedCents: number;
  /** The total, for the first message. */
  totalCents: number;
  deposit: boolean;
  /** "Thursday, Nov 21" on the company's clock, or null when there is no due date. */
  dueWords: string | null;
  /** What the invoice is for, from its first line. */
  forWhat: string | null;
  now: number;
  dueAt: number | null;
};

const firstName = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  // "The Hollis family" or "Oak Hill Dental" read better whole.
  return /^(the|mr|mrs|ms|dr)\.?$/i.test(first) || name.split(/\s+/).length > 2 ? name.trim() : first;
};

const DAY = 86_400_000;

function lateWords(now: number, dueAt: number | null): string {
  if (dueAt === null) return "is now past due";
  const days = Math.max(1, Math.floor((now - dueAt) / DAY));
  return days === 1 ? "was due yesterday" : `is ${days} days past due`;
}

export function emailFor(stage: FinanceMessageStage, input: TemplateInput): { subject: string; body: string } {
  const amount = dollars(input.requestedCents);
  const number = input.invoice.number ?? "your invoice";
  const hello = `Hi ${firstName(input.customer)},`;
  const sign = `Thank you,\n${input.company}`;
  const what = input.forWhat ? ` for ${input.forWhat}` : "";
  const memo = input.invoice.memo ? `\n\n${input.invoice.memo}` : "";
  const due = input.dueWords ? `, due ${input.dueWords}` : "";
  switch (stage) {
    case "invoice":
      return {
        subject: `${input.deposit ? "Deposit request" : "Invoice"} ${number} from ${input.company}`,
        body: input.deposit
          ? `${hello}\n\nHere is your invoice ${number}${what}. To confirm your booking, a deposit of ${amount} is due${input.dueWords ? ` by ${input.dueWords}` : " now"}. The rest (${dollars(input.totalCents - input.requestedCents)}) is due after your service.\n\nView and pay securely: {link}${memo}\n\n${sign}`
          : `${hello}\n\nHere is your invoice ${number}${what}: ${amount}${due}.\n\nView and pay securely: {link}${memo}\n\n${sign}`,
      };
    case "before_due":
      return {
        subject: `Reminder: ${number} is due ${input.dueWords ?? "soon"}`,
        body: `${hello}\n\nA friendly reminder that ${amount} for ${number}${what} is due ${input.dueWords ?? "soon"}.\n\nView and pay: {link}\n\nIf you've already paid, thank you, and please ignore this.\n\n${sign}`,
      };
    case "overdue_1":
    case "overdue_7":
    case "overdue_14":
    case "manual": {
      const late = input.dueAt !== null && input.now > input.dueAt;
      return {
        subject: late ? `${number} ${lateWords(input.now, input.dueAt)}` : `Reminder about ${number}`,
        body: late
          ? `${hello}\n\nOur records show ${amount} for ${number}${what} ${lateWords(input.now, input.dueAt)}.\n\nYou can pay here: {link}\n\nIf you've already paid or have a question about this invoice, just reply to this email.\n\n${sign}`
          : `${hello}\n\nA reminder that ${amount} for ${number}${what} is ${input.dueWords ? `due ${input.dueWords}` : "open"}.\n\nView and pay: {link}\n\n${sign}`,
      };
    }
  }
}

/** A text: short, names the business first, and says how to stop texts. */
export function textFor(stage: FinanceMessageStage, input: TemplateInput): string {
  const amount = dollars(input.requestedCents);
  const number = input.invoice.number ?? "your invoice";
  const stop = "Reply STOP to stop texts.";
  switch (stage) {
    case "invoice":
      return `${input.company}: ${input.deposit ? `deposit of ${amount} for ` : ""}invoice ${number}${input.deposit ? "" : ` for ${amount}`}${input.dueWords ? `, due ${input.dueWords}` : ""}. View and pay: {link} ${stop}`;
    case "before_due":
      return `${input.company}: reminder, ${amount} for ${number} is due ${input.dueWords ?? "soon"}. Pay: {link} ${stop}`;
    default: {
      const late = input.dueAt !== null && input.now > input.dueAt;
      return `${input.company}: ${amount} for ${number} ${late ? lateWords(input.now, input.dueAt) : "is open"}. Pay: {link} Already paid? Please ignore. ${stop}`;
    }
  }
}

/** The step of the schedule, not how late the invoice is: the message itself says that. */
export const STAGE_WORDS: Record<FinanceMessageStage, string> = {
  invoice: "Invoice",
  before_due: "Due-soon note",
  overdue_1: "1-day reminder",
  overdue_7: "7-day reminder",
  overdue_14: "14-day reminder",
  manual: "Reminder",
};
