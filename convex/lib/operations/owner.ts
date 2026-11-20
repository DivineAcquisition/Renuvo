/**
 * What a company's people see about an incident (docs/operations/04-owner-recovery.md): a plain title,
 * what is affected, what Selestial has already done, and one next step. Provider codes, record ids and
 * diagnostics stay with Selestial staff.
 *
 * Everything here is worked out from the incident as it is now, so a card never claims recovery that the
 * records do not show. Platform incidents and Selestial's own bookkeeping have no card: the company's
 * work is not affected by them, or another notice already covers it.
 */
import type { Doc } from "../../_generated/dataModel";

/** Where a card also appears, beside the work it affects. Every card appears on Home. */
export type Place = "home" | "integrations" | "texting" | "first-work" | "notifications";

export type CardAction =
  /** Opens the exact page where the owner completes it. */
  | { kind: "link"; label: string; href: string }
  /** Runs the existing retry for one piece of first agent work (activation.retry, Owner only). */
  | { kind: "retry"; label: string; taskId: string }
  /** Nothing for the company to do: the card shows what Selestial is doing, and support is a click away. */
  | { kind: "none" };

export type OwnerCard = {
  title: string;
  /** What is affected, and what is safe. */
  affected: string;
  /** What Selestial has done, from the records. */
  done: string;
  action: CardAction;
  places: Place[];
  /** "action": the company has a step to take. "info": Selestial is handling it. */
  tone: "action" | "info";
};

const many = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

function selestialDid(incident: Doc<"incidents">, retrying: string): string {
  if (incident.state === "needs_staff" || incident.state === "investigating") {
    return incident.recoveryAttempts > 0 ? `Selestial tried again ${many(incident.recoveryAttempts, "time", "times")}, and its team is now working on it.` : "Selestial's team has been told and is working on it.";
  }
  if (incident.state === "recovering") return incident.recoveryAttempts > 0 ? `${retrying} (${many(incident.recoveryAttempts, "try", "tries")} so far).` : `${retrying}.`;
  if (incident.state === "waiting_provider") return "Selestial is following it up with the provider and will tell you if anything is needed from you.";
  return "Selestial saved everything so far and paused this step until you act.";
}

function relatedId(incident: Doc<"incidents">, table: string): string | null {
  return incident.related.find((ref) => ref.table === table)?.id ?? null;
}

/** The card for an incident, or null when the company has nothing to see. */
export function ownerCard(incident: Doc<"incidents">): OwnerCard | null {
  if (!incident.companyId) return null;
  switch (incident.kind) {
    case "mailbox_reconnect": {
      const hiring = incident.impact.includes("Recruiter");
      return {
        title: hiring ? "Your hiring inbox needs reconnecting" : "Your inbox needs reconnecting",
        affected: hiring ? "Recruiter can't check new applications. Your existing applicants are saved." : "Agents can't read new mail in this inbox. Everything already read is saved.",
        done: selestialDid(incident, ""),
        action: { kind: "link", label: "Reconnect Gmail", href: "/app/settings/integrations?tool=gmail" },
        places: ["home", "integrations"],
        tone: "action",
      };
    }
    case "mailbox_read_failing":
      return {
        title: "We're having trouble reading your inbox",
        affected: "New mail may reach your agents late. Everything already read is saved.",
        done: selestialDid(incident, "Selestial is reading it again every 10 minutes"),
        action: { kind: "link", label: "Review the inbox", href: "/app/settings/integrations?tool=gmail" },
        places: ["home", "integrations"],
        tone: "info",
      };
    case "google_reconnect":
      return {
        title: "Google needs reconnecting",
        affected: incident.impact,
        done: selestialDid(incident, ""),
        action: { kind: "link", label: "Reconnect Google", href: "/app/settings/integrations#google" },
        places: ["home", "integrations"],
        tone: "action",
      };
    case "google_job_failed":
      return {
        title: "A Google task couldn't finish",
        affected: "One piece of work with Google stopped after its retries. Nothing else is affected.",
        done: incident.state === "waiting_owner" ? "It waits for Google to be reconnected." : selestialDid(incident, ""),
        action: incident.state === "waiting_owner" ? { kind: "link", label: "Reconnect Google", href: "/app/settings/integrations#google" } : { kind: "none" },
        places: ["home", "integrations"],
        tone: incident.state === "waiting_owner" ? "action" : "info",
      };
    case "google_job_uncertain":
      return {
        title: "We're checking whether a Google change went through",
        affected: "Google may or may not have made one change. Nothing is sent to Google again until we know.",
        done: selestialDid(incident, "Selestial is checking it with Google before anything is tried again"),
        action: { kind: "none" },
        places: ["home", "integrations"],
        tone: "info",
      };
    case "connector_reconnect":
      return {
        title: `${incident.provider === "housecall_pro" ? "Housecall Pro" : "Jobber"} needs reconnecting`,
        affected: "Clients can't be imported from it right now. Clients already imported are kept.",
        done: selestialDid(incident, ""),
        action: { kind: "link", label: "Reconnect", href: "/app/setup?step=records" },
        places: ["home", "integrations"],
        tone: "action",
      };
    case "message_unconfirmed":
      return {
        title: incident.occurrences === 1 ? "We're checking whether a message was sent" : `We're checking whether ${incident.occurrences} messages were sent`,
        affected: "It isn't known yet whether they reached the person.",
        done: "Selestial paused any further attempt while it checks the delivery status, so nobody gets the same message twice.",
        action: { kind: "none" },
        places: ["home"],
        tone: "info",
      };
    case "owner_notice_failing":
      return {
        title: "Your notification emails aren't arriving",
        affected: "You may not hear by email about decisions waiting for you. They still appear here in Selestial.",
        done: selestialDid(incident, ""),
        action: { kind: "link", label: "Check your email settings", href: "/app/settings/notifications" },
        places: ["home", "notifications"],
        tone: "action",
      };
    case "texting_needs_owner":
      return {
        title: "Business texting needs your answer",
        affected: incident.impact,
        done: "Selestial kept everything you filled in. Only what the carriers asked about needs changing.",
        action: { kind: "link", label: "Open texting setup", href: "/app/texting" },
        places: ["home", "texting"],
        tone: "action",
      };
    case "texting_interrupted":
      return {
        title: "The carriers paused your business texting",
        affected: "Texts from your number are on hold. Nothing will go out all at once when it's restored.",
        done: selestialDid(incident, ""),
        action: { kind: "link", label: "See what's happening", href: "/app/texting?step=progress" },
        places: ["home", "texting"],
        tone: "info",
      };
    case "texting_failed":
    case "texting_stalled":
    case "texting_number_not_connected":
      return {
        title: "We're finishing your texting setup",
        affected: "Business texting isn't ready yet. Nothing is charged twice and nothing you filled in is lost.",
        done: "Selestial's team is working on it with the carriers.",
        action: { kind: "link", label: "See where it stands", href: "/app/texting?step=progress" },
        places: ["home", "texting"],
        tone: "info",
      };
    case "agent_task_failed": {
      const taskId = relatedId(incident, "activationTasks");
      return {
        title: incident.occurrences === 1 ? "A piece of your agents' first work couldn't finish" : `${incident.occurrences} pieces of your agents' first work couldn't finish`,
        affected: "Anything it already made is kept. Nothing was sent to customers.",
        done: "Selestial tried it again on its own before stopping.",
        action: taskId ? { kind: "retry", label: "Try again", taskId } : { kind: "link", label: "Review your agents' work", href: "/app/first-work" },
        places: ["home", "first-work"],
        tone: "action",
      };
    }
    case "agent_task_lease_expired":
      return {
        title: "Your agents' first work is taking longer than expected",
        affected: "Anything it already made is kept.",
        done: "Selestial's team has been told and is restarting it.",
        action: { kind: "link", label: "Review your agents' work", href: "/app/first-work" },
        places: ["home", "first-work"],
        tone: "info",
      };
    default:
      // Billing settlements, balance attention and platform checks are Selestial's own: no card.
      return null;
  }
}

/** Kinds that already send their own dedicated email (inbox_reconnect, texting_attention): no second one. */
export const OWN_EMAIL_KINDS: ReadonlySet<Doc<"incidents">["kind"]> = new Set(["mailbox_reconnect", "texting_needs_owner", "texting_interrupted"]);
/** Kinds whose email would not reach the owner anyway: in the app only. */
export const NO_EMAIL_KINDS: ReadonlySet<Doc<"incidents">["kind"]> = new Set(["owner_notice_failing"]);

/** A short, stable reference the company and support can both quote. */
export function incidentReference(id: string): string {
  return `INC-${id.slice(-6).toUpperCase()}`;
}

/** The timeline in the company's words, from the state each update moved to. */
export function ownerUpdate(update: Doc<"incidentUpdates">): string | null {
  if (update.kind === "opened") return "Selestial noticed the problem.";
  if (update.kind === "reopened") return "The problem came back. Selestial is on it again.";
  if (update.kind === "recovery") return "Selestial tried again.";
  if (update.kind === "resolved") return "Fixed, and checked.";
  if (update.kind === "state") {
    if (update.state === "needs_staff") return "Selestial's team took over.";
    if (update.state === "recovering") return "Selestial is retrying it automatically.";
    if (update.state === "waiting_owner") return "It's waiting for you.";
    if (update.state === "waiting_provider") return "It's waiting on the provider.";
  }
  if (update.kind === "note" && update.by === "system") return update.words;
  return null;
}
