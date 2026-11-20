/**
 * Alerts to Selestial staff, grouped: every pending alert goes out in one message per person each time
 * the sender runs, never one message per incident or per retry (docs/operations/04-owner-recovery.md).
 *
 * Channels are one interface, so another (Discord, decided for later) is added here without touching
 * detection or notification. Each channel gets the same batch and says whether it went.
 */
import { emailLayout, emailText, escapeHtml } from "../email/layout";
import { emailProvider } from "../email/provider";

export type AlertLine = {
  reason: "critical" | "needs_staff" | "recovery_exhausted" | "owner_asked";
  title: string;
  company: string | null;
  severity: string;
  reference: string;
  at: number;
};

export type AlertBatch = { key: string; lines: AlertLine[]; consoleUrl: string | null };
export type Recipient = { email: string; name: string };

export interface AlertChannel {
  name: string;
  /** Sends the batch to these people. True when it went (or there was nobody to send to). */
  send(batch: AlertBatch, recipients: Recipient[]): Promise<boolean>;
}

const REASON_WORDS: Record<AlertLine["reason"], string> = {
  critical: "Critical",
  needs_staff: "Needs staff",
  recovery_exhausted: "Automatic recovery ran out",
  owner_asked: "A company asked for help",
};

/** The grouped email. Pure. It names incidents and companies, never customers, messages or secrets. */
export function alertEmail(batch: AlertBatch): { subject: string; html: string; text: string } {
  const count = batch.lines.length;
  const critical = batch.lines.filter((line) => line.reason === "critical").length;
  const heading = critical ? `${critical} critical ${critical === 1 ? "incident" : "incidents"} in Selestial` : `${count} ${count === 1 ? "incident needs" : "incidents need"} Selestial staff`;
  const lines = batch.lines.map((line) => `${REASON_WORDS[line.reason]} · ${line.title}${line.company ? ` · ${line.company}` : ""} · ${line.severity} · ${line.reference}`);
  const action = batch.consoleUrl ? { label: "Open Operations", url: batch.consoleUrl } : undefined;
  const bodyHtml = lines.map((line) => `<p style="margin:0 0 10px 0;">${escapeHtml(line)}</p>`).join("");
  return {
    subject: heading,
    html: emailLayout({ preheader: lines[0] ?? heading, heading, bodyHtml, action, footnote: "Details, records and diagnostics are in the staff Operations workspace, not in this email." }),
    text: emailText({ heading, lines, action }),
  };
}

export const emailChannel: AlertChannel = {
  name: "email",
  async send(batch, recipients) {
    const provider = emailProvider();
    if (!provider) return false;
    const message = alertEmail(batch);
    let ok = true;
    for (const person of recipients) {
      try {
        // One key per batch and person, so a retry of the same batch never sends twice.
        const result = await provider.send({ to: person.email, ...message, idempotencyKey: `staff-alerts-${batch.key}-${person.email}` });
        if (!result.ok && result.retryable) ok = false;
      } catch {
        ok = false;
      }
    }
    return ok;
  },
};

/** The channels in use. Discord is added here when it is set up. */
export const ALERT_CHANNELS: readonly AlertChannel[] = [emailChannel];
