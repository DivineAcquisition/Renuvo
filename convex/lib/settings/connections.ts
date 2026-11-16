/**
 * What this deployment is connected to, in words that do not overstate it.
 *
 * Four different things are kept apart:
 * - configured: an adapter is built and this deployment has the configuration it needs. Nothing here
 *   checks the outside service is reachable, so it does not say "working" or "healthy".
 * - test_mode: a stand-in is selected. Nothing real is sent or read.
 * - not_configured: an adapter exists but this deployment has not been given what it needs.
 * - unavailable: no adapter is built for it yet, so it cannot be configured at all.
 *
 * No credential, key or address of a provider is ever returned.
 */
import { linksConfigured } from "../dispatch/links";
import { emailProvider } from "../messaging/email";
import { messagingProvider } from "../messaging/provider";
import { calendarProvider } from "../recruiter/calendar";
import { hiringModel } from "../recruiter/model";
import { signatureProvider } from "../recruiter/signature";

export type ConnectionState = "configured" | "test_mode" | "not_configured" | "unavailable";

export type Connection = { key: string; label: string; state: ConnectionState; detail: string; usedBy: string[] };

const TEST = "A test stand-in is selected. Nothing real is sent or read.";

export function connectionList(input: { mailboxes: { provider: string; status: string }[] }): Connection[] {
  const out: Connection[] = [];

  const email = emailProvider();
  out.push({
    key: "email",
    label: "Email",
    state: email === null ? "not_configured" : email.name === "mock-email" ? "test_mode" : "configured",
    detail: email === null ? "Invitations and applicant emails are not sent. Links can still be copied by hand." : email.name === "mock-email" ? TEST : "An email provider is configured. Delivery is confirmed only by the provider's later report.",
    usedBy: ["Invitations", "Recruiter"],
  });

  const texting = messagingProvider();
  out.push({
    key: "texting",
    label: "Text messages",
    state: texting === null ? "not_configured" : texting.name === "mock" ? "test_mode" : "unavailable",
    detail: texting === null ? "No text-message provider is selected." : texting.name === "mock" ? TEST : "A provider is named but its connection is not built, so no text can be sent.",
    usedBy: ["Dispatch", "Recruiter"],
  });

  out.push({
    key: "action_links",
    label: "Cleaner and applicant links",
    state: linksConfigured() ? "configured" : "not_configured",
    detail: linksConfigured() ? "Signed links can be issued and opened." : "Links cannot be issued until the deployment has a signing secret.",
    usedBy: ["Dispatch", "Recruiter"],
  });

  const calendar = calendarProvider();
  out.push({
    key: "calendar",
    label: "Interviewer calendars",
    state: calendar === null ? "unavailable" : "test_mode",
    detail: calendar === null ? "No calendar adapter is built. Interview slots are held in Selestial only." : TEST,
    usedBy: ["Recruiter"],
  });

  const signing = signatureProvider();
  out.push({
    key: "signing",
    label: "E-signature",
    state: signing === null ? "unavailable" : "test_mode",
    detail: signing === null ? "No e-signature adapter is built. Agreements are not sent for signing." : TEST,
    usedBy: ["Recruiter"],
  });

  const connected = input.mailboxes.filter((row) => row.status === "connected").length;
  const real = input.mailboxes.filter((row) => row.provider !== "mock").length;
  out.push({
    key: "hiring_inbox",
    label: "Hiring inbox",
    state: input.mailboxes.length === 0 ? "not_configured" : real > 0 ? "unavailable" : "test_mode",
    detail:
      input.mailboxes.length === 0
        ? "No hiring inbox has been recorded."
        : real > 0
          ? "A mailbox is recorded, but no connector for its provider is built, so nothing is read from it."
          : `${connected} of ${input.mailboxes.length} recorded mailbox${input.mailboxes.length === 1 ? " is" : "es are"} a test stand-in.`,
    usedBy: ["Recruiter"],
  });

  const reader = hiringModel().name;
  out.push({
    key: "reader",
    label: "Application reader",
    state: reader === "mock" ? "test_mode" : "configured",
    detail: reader === "mock" ? TEST : reader === "rules" ? "Built-in rules read applications. No outside model is used." : "A language model is configured to read applications. It proposes; a person decides.",
    usedBy: ["Recruiter"],
  });

  out.push({ key: "payments", label: "Customer payments and cleaner pay", state: "unavailable", detail: "No payment or payroll adapter is built.", usedBy: ["Finance"] });
  out.push({ key: "billing", label: "Selestial subscription billing", state: "unavailable", detail: "No billing provider is connected. See Plan & billing.", usedBy: ["Plan & billing"] });
  return out;
}
