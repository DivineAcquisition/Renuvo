/**
 * Who may do what with the company's money. Each kind of authority is named on its own, so reading the
 * books never implies sending a message, and approving earnings never implies paying them.
 *
 * Today every capability belongs to the Owner (the owner's decision of November 15, 2026: Finance is
 * Owner-only). Agents may only read and prepare drafts; anything that sends, charges, refunds, pays or
 * writes off waits for a person, and the person-only list in convex/lib/permissionCatalog.ts still
 * applies. A general request such as "improve profitability" grants none of these.
 *
 * This is checked in Convex on every call. The sidebar hiding Finance is a convenience, not the rule.
 */
import { notAllowed } from "../errors";
import type { Role } from "../roles";

export const FINANCE_CAPABILITIES = [
  "read", // see amounts, balances, payments and history
  "analyze", // explanations and summaries over the records
  "draft", // prepare an invoice, a reminder or an adjustment that nobody sees yet
  "edit", // change records: settings, drafts, credits, recording a payment received
  "send", // put something in front of a customer: issue an invoice, share a pay link, send a reminder
  "approve_earnings", // agree what a cleaner earned
  "initiate_payments", // start money moving out: pay a cleaner, charge a saved card
  "issue_refunds", // give money back
  "write_off", // stop asking for money that is owed
] as const;
export type FinanceCapability = (typeof FINANCE_CAPABILITIES)[number];

/** What each role holds. Managers and Office hold nothing until the Owner decides otherwise. */
const BY_ROLE: Record<Role, readonly FinanceCapability[]> = {
  owner: FINANCE_CAPABILITIES,
  manager: [],
  office: [],
};

/** What an agent may do in Finance on its own. Everything else becomes a proposal for the Owner. */
export const AGENT_FINANCE: readonly FinanceCapability[] = ["read", "analyze", "draft"];

/** Capabilities that move money or speak to a customer. They always show the exact action before it runs. */
export const NEEDS_CONFIRMATION: readonly FinanceCapability[] = ["send", "initiate_payments", "issue_refunds", "write_off", "approve_earnings"];

export function holds(role: Role, capability: FinanceCapability): boolean {
  return BY_ROLE[role].includes(capability);
}

/** Refuses unless the member's role holds the capability. The same "Not allowed." as anything else refused. */
export function requireFinance(ctx: { role: Role }, capability: FinanceCapability): void {
  if (!holds(ctx.role, capability)) notAllowed();
}
