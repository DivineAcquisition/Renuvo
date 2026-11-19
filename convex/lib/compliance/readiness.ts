/**
 * What the company can do right now, operation by operation, and what stands in the way. Each operation
 * says plainly whether it is ready, blocked or needs attention; there is no single "compliant" answer,
 * because being set up to send is not the same as every message being lawful. Texting being blocked
 * blocks texting only: reading the record never depends on any of this.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { AGENT_PROFILES } from "../departments";
import { senderGaps } from "../messaging/policy";
import { currentVersion } from "../trust/documents";
import { latestAcceptance } from "./agreements";
import { currentPermission } from "./permissions";
import { readProfile } from "./profile";

type Ctx = QueryCtx | MutationCtx;

export const OPERATION_KEYS = ["sms", "email", "agents", "data", "agreements", "identity"] as const;
export type OperationKey = (typeof OPERATION_KEYS)[number];
export type Blocker = { key: string; words: string; next: string; href?: string };
export type Operation = { key: OperationKey; label: string; state: "ready" | "blocked" | "attention"; blockers: Blocker[] };
export type Readiness = { operations: Operation[] };

const SETTINGS = "/app/settings/compliance";
const SUSPENDED: Blocker = { key: "suspended", words: "Selestial has suspended sending for this company.", next: "Contact Selestial support to find out why and what is needed." };

function op(key: OperationKey, ready: string, notReady: string, blockers: Blocker[], attention: Blocker[] = []): Operation {
  if (blockers.length > 0) return { key, label: notReady, state: "blocked", blockers: [...blockers, ...attention] };
  if (attention.length > 0) return { key, label: notReady, state: "attention", blockers: attention };
  return { key, label: ready, state: "ready", blockers: [] };
}

const SMS_NEXT: Record<string, Blocker> = {
  sender_name: { key: "sender_name", words: "", next: "Set up business texting: it sets the name texts are sent as.", href: "/app/texting" },
  sms_number: { key: "sms_number", words: "", next: "Set up business texting to get your own number.", href: "/app/texting" },
  registration: { key: "registration", words: "", next: "Set up business texting: Selestial prepares and files your carrier registration.", href: "/app/texting" },
};

export async function readiness(ctx: Ctx, company: Doc<"companies">): Promise<Readiness> {
  const companyId = company._id;
  const profile = await readProfile(ctx, companyId);
  const suspended = company.suspendedAt !== undefined ? [SUSPENDED] : [];
  const operations: Operation[] = [];

  // Texting.
  const rejected = profile.messaging.registration.status === "rejected";
  const smsGaps = senderGaps(profile.messaging, "sms").map((gap) => ({
    ...SMS_NEXT[gap.key],
    words: gap.words,
    ...(gap.key === "registration" && rejected ? { next: "Read the provider's reasons, correct the registration and submit it again." } : {}),
  }));
  const sms = op("sms", "Ready for SMS", suspended.length ? "Texting is suspended" : smsGaps.some((gap) => gap.key === "registration") ? "Texting needs carrier registration approval" : "Texting is not set up", [...suspended, ...smsGaps]);
  operations.push(sms);

  // Email.
  const emailGaps = senderGaps(profile.messaging, "email").map((gap) => ({ key: gap.key, words: gap.words, next: "Enter the address emails are sent from.", href: `${SETTINGS}#messaging` }));
  operations.push(op("email", "Ready for email", suspended.length ? "Email is suspended" : "Email is not set up", [...suspended, ...emailGaps]));

  // Agents.
  const paused = company.pausedAgents.map((agent) => ({ key: `paused_${agent}`, words: `${AGENT_PROFILES[agent].name} is paused and sends nothing.`, next: "Resume it when you are ready.", href: "/app/settings" }));
  const agentAttention = sms.state === "ready" ? paused : [...paused, { key: "agents_cannot_text", words: "Agents cannot text anyone until texting is ready.", next: "Finish the texting setup above.", href: `${SETTINGS}#messaging` }];
  operations.push(op("agents", "Agents can send", suspended.length ? "Agents are suspended" : "Agents need attention", suspended, agentAttention));

  // Recipient choices on file.
  operations.push(await dataOperation(ctx, companyId));

  // Selestial's agreement.
  operations.push(await agreementOperation(ctx, companyId));

  // Who the company is.
  const missing: Blocker[] = [];
  const identity = profile.identity;
  if (!identity.legalName) missing.push({ key: "legal_name", words: "The company's legal name is missing.", next: "Enter the legal name as registered.", href: `${SETTINGS}#identity` });
  if (!identity.address) missing.push({ key: "address", words: "The business address is missing.", next: "Enter the business address.", href: `${SETTINGS}#identity` });
  if (!identity.representative) missing.push({ key: "representative", words: "No authorised representative is named.", next: "Name the person who answers for the company's messaging.", href: `${SETTINGS}#identity` });
  if (!identity.supportEmail && !identity.supportPhone) missing.push({ key: "support_contact", words: "There is no support contact for people who ask for help.", next: "Enter a support email or phone number.", href: `${SETTINGS}#identity` });
  operations.push(op("identity", "Business details complete", "Business details are incomplete", [], missing));

  return { operations };
}

const SCAN = 500;

async function dataOperation(ctx: Ctx, companyId: Id<"companies">): Promise<Operation> {
  const attention: Blocker[] = [];
  let without = 0;
  for (const status of ["ready", "onboarding"] as const) {
    const rows = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(SCAN);
    for (const row of rows) {
      if (!row.phone) continue;
      const permission = await currentPermission(ctx, companyId, { kind: "cleaner", id: row._id }, "sms", "operational");
      if (!permission || permission.status !== "granted" || permission.source === "import") without += 1;
    }
  }
  if (without > 0) {
    attention.push({
      key: "cleaner_permissions",
      words: `${without} ${without === 1 ? "cleaner has" : "cleaners have"} no texting permission on file, so Dispatch cannot text them.`,
      next: "Record how each one agreed to work texts, for example on their onboarding form.",
      href: "/app/cleaners",
    });
  }
  const disclosure = await ctx.db
    .query("consentDisclosures")
    .withIndex("by_company_channel_category", (q) => q.eq("companyId", companyId).eq("channel", "sms").eq("category", "marketing"))
    .first();
  if (!disclosure) {
    attention.push({ key: "marketing_disclosure", words: "There is no wording on file for marketing texts, so none can be sent.", next: "Add the exact wording people see when they agree to marketing texts.", href: `${SETTINGS}#disclosures` });
  }
  return op("data", "Contact permissions on file", "Contact permissions need attention", [], attention);
}

async function agreementOperation(ctx: Ctx, companyId: Id<"companies">): Promise<Operation> {
  const terms = currentVersion("terms");
  const latest = await latestAcceptance(ctx, companyId, "terms");
  if (latest?.documentId === terms.id) return op("agreements", "Terms accepted", "", []);
  const words = latest ? `The ${terms.title} changed on ${terms.effectiveOn}. The Owner has not accepted this version.` : `The Owner has not accepted the ${terms.title}.`;
  return op("agreements", "Terms accepted", "Terms need acceptance", [], [{ key: "terms", words, next: "The Owner reads and accepts the current version.", href: "/app/settings/agreements" }]);
}
