/**
 * What needs the Owner's attention in Finance, found in the records. Every finding names the records it
 * came from and the amounts they hold; nothing is estimated, invented or projected. A finding is only a
 * pointer: acting on it is always a separate, visible step.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { amountRequested, invoiceState } from "./invoiceState";

export type FindingRecord =
  | { kind: "invoice"; id: Id<"invoices">; label: string; detail: string; amountCents: number }
  | { kind: "job"; id: Id<"jobs">; label: string; detail: string; amountCents: number | null }
  | { kind: "payment"; id: Id<"payments">; invoiceId: Id<"invoices">; label: string; detail: string; amountCents: number };

export type Finding = {
  id: string;
  tone: "danger" | "warning" | "info";
  /** The state of the work, as it really is. Nothing is prepared on its own yet, so every finding is waiting on the Owner. */
  state: "needs_attention" | "needs_your_approval";
  title: string;
  /** What was found, with the numbers. */
  noticed: string;
  /** What Selestial recommends, in one sentence. */
  recommend: string;
  records: FindingRecord[];
  /** The one action the card offers. Every one opens a real record or a real form. */
  action: { label: string; kind: "open_invoice" | "invoice_jobs" | "open_setup" | "filter_invoices"; filter?: "overdue" | "drafts" };
  totalCents: number | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type FindingInput = {
  now: number;
  invoices: Doc<"invoices">[];
  customerName: (id: Id<"customers">) => string;
  /** Completed visits with a price and no invoice that is not void. */
  uninvoicedJobs: { job: Doc<"jobs">; customer: string; label: string }[];
  /** Card payments that failed or need checking, on invoices still open. */
  troubledPayments: Doc<"payments">[];
  stripe: { state: "not_available" | "not_connected" | "onboarding" | "active" | "restricted" | "disconnected"; problem: string | null };
  money: (cents: number) => string;
};

export function findings(input: FindingInput): Finding[] {
  const { now, invoices, money } = input;
  const out: Finding[] = [];
  const label = (invoice: Doc<"invoices">) => `${invoice.number ?? "Draft"} · ${input.customerName(invoice.customerId)}`;

  const disputed = input.troubledPayments.filter((p) => p.dispute && p.dispute.status !== "won" && p.dispute.status !== "lost");
  if (disputed.length) {
    out.push({
      id: "disputes",
      tone: "danger",
      state: "needs_attention",
      title: `${plural(disputed.length, "payment")} disputed`,
      noticed: `A customer's bank is disputing ${plural(disputed.length, "payment")} totaling ${money(disputed.reduce((s, p) => s + (p.dispute?.amountCents ?? 0), 0))}.`,
      recommend: "Respond in your Stripe Dashboard before Stripe's deadline; Selestial keeps the payment marked until Stripe settles it.",
      records: disputed.slice(0, 5).map((p) => ({ kind: "payment", id: p._id, invoiceId: p.invoiceId, label: input.customerName(p.customerId), detail: `Disputed ${money(p.dispute?.amountCents ?? 0)}`, amountCents: p.amountCents })),
      action: { label: "Open the invoice", kind: "open_invoice" },
      totalCents: disputed.reduce((s, p) => s + p.amountCents, 0),
    });
  }

  const checking = input.troubledPayments.filter((p) => p.status === "checking");
  if (checking.length) {
    out.push({
      id: "checking",
      tone: "warning",
      state: "needs_attention",
      title: `${plural(checking.length, "payment")} being confirmed with Stripe`,
      noticed: `Stripe didn't give a clear answer for ${plural(checking.length, "payment")}. Selestial is asking again with the same request, so nothing can be charged twice.`,
      recommend: "Nothing to do yet. If it stays unconfirmed, check the payment in your Stripe Dashboard before asking the customer to pay again.",
      records: checking.slice(0, 5).map((p) => ({ kind: "payment", id: p._id, invoiceId: p.invoiceId, label: input.customerName(p.customerId), detail: "Checking with Stripe", amountCents: p.amountCents })),
      action: { label: "Open the invoice", kind: "open_invoice" },
      totalCents: checking.reduce((s, p) => s + p.amountCents, 0),
    });
  }

  const failed = input.troubledPayments.filter((p) => p.status === "failed");
  if (failed.length) {
    out.push({
      id: "failed",
      tone: "warning",
      state: "needs_attention",
      title: `${plural(failed.length, "card payment")} didn't go through`,
      noticed: `${plural(failed.length, "attempt")} totaling ${money(failed.reduce((s, p) => s + p.amountCents, 0))} ${failed.length === 1 ? "was" : "were"} declined. The invoices are still open and the pay links still work.`,
      recommend: "Let the customer know the payment didn't go through and share the pay link again.",
      records: failed.slice(0, 5).map((p) => ({ kind: "payment", id: p._id, invoiceId: p.invoiceId, label: input.customerName(p.customerId), detail: p.problem ?? "Declined", amountCents: p.amountCents })),
      action: { label: "Open the invoice", kind: "open_invoice" },
      totalCents: failed.reduce((s, p) => s + p.amountCents, 0),
    });
  }

  const overdue = invoices.filter((invoice) => invoiceState(invoice, now) === "overdue").sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  if (overdue.length) {
    const total = overdue.reduce((s, invoice) => s + amountRequested(invoice), 0);
    out.push({
      id: "overdue",
      tone: "danger",
      state: "needs_attention",
      title: `${plural(overdue.length, "invoice")} overdue`,
      noticed: `${money(total)} is past due across ${plural(overdue.length, "invoice")}. The oldest was due ${Math.max(1, Math.floor((now - (overdue[0].dueAt ?? now)) / 86_400_000))} days ago.`,
      recommend: "Follow up with each customer and share their pay link. Reminder drafts arrive with customer messaging.",
      records: overdue.slice(0, 5).map((invoice) => ({ kind: "invoice", id: invoice._id, label: label(invoice), detail: `${money(amountRequested(invoice))} due`, amountCents: amountRequested(invoice) })),
      action: { label: "See overdue invoices", kind: "filter_invoices", filter: "overdue" },
      totalCents: total,
    });
  }

  const overpaid = invoices.filter((invoice) => invoice.status !== "void" && invoice.totals.balanceCents < 0);
  if (overpaid.length) {
    out.push({
      id: "overpaid",
      tone: "warning",
      state: "needs_attention",
      title: `${plural(overpaid.length, "customer")} paid more than they owe`,
      noticed: `${money(-overpaid.reduce((s, invoice) => s + invoice.totals.balanceCents, 0))} was paid beyond the invoice total.`,
      recommend: "Review the payments and refund the difference, or keep it if the customer asked you to.",
      records: overpaid.slice(0, 5).map((invoice) => ({ kind: "invoice", id: invoice._id, label: label(invoice), detail: `Overpaid ${money(-invoice.totals.balanceCents)}`, amountCents: -invoice.totals.balanceCents })),
      action: { label: "Open the invoice", kind: "open_invoice" },
      totalCents: -overpaid.reduce((s, invoice) => s + invoice.totals.balanceCents, 0),
    });
  }

  if (input.uninvoicedJobs.length) {
    const priced = input.uninvoicedJobs.reduce((s, row) => s + (row.job.priceCents ?? 0), 0);
    out.push({
      id: "uninvoiced",
      tone: "info",
      state: "needs_attention",
      title: `${plural(input.uninvoicedJobs.length, "completed visit")} not invoiced`,
      noticed: `${plural(input.uninvoicedJobs.length, "visit")} finished with a price of ${money(priced)} in total and no invoice yet.`,
      recommend: "Create the invoices from the visits. Each starts as a draft you review before the customer sees anything.",
      records: input.uninvoicedJobs.slice(0, 5).map((row) => ({ kind: "job", id: row.job._id, label: row.customer, detail: row.label, amountCents: row.job.priceCents ?? null })),
      action: { label: "Review visits", kind: "invoice_jobs" },
      totalCents: priced,
    });
  }

  const readyForBalance = invoices.filter((invoice) => invoiceState(invoice, now) === "deposit_paid");
  if (readyForBalance.length) {
    out.push({
      id: "balance",
      tone: "info",
      state: "needs_attention",
      title: `${plural(readyForBalance.length, "deposit")} paid, balance not requested`,
      noticed: `${money(readyForBalance.reduce((s, invoice) => s + invoice.totals.balanceCents, 0))} remains after the deposits on ${plural(readyForBalance.length, "invoice")}.`,
      recommend: "Request the balance once the service is complete.",
      records: readyForBalance.slice(0, 5).map((invoice) => ({ kind: "invoice", id: invoice._id, label: label(invoice), detail: `${money(invoice.totals.balanceCents)} left`, amountCents: invoice.totals.balanceCents })),
      action: { label: "Open the invoice", kind: "open_invoice" },
      totalCents: readyForBalance.reduce((s, invoice) => s + invoice.totals.balanceCents, 0),
    });
  }

  const unshared = invoices.filter((invoice) => invoice.status === "open" && !invoice.shared && invoice.issuedAt !== undefined && now - invoice.issuedAt > 6 * 3_600_000);
  if (unshared.length) {
    out.push({
      id: "unshared",
      tone: "info",
      state: "needs_attention",
      title: `${plural(unshared.length, "invoice")} issued but not shared`,
      noticed: `${plural(unshared.length, "customer")} ${unshared.length === 1 ? "hasn't" : "haven't"} been given a pay link yet, as far as Selestial knows.`,
      recommend: "Copy the pay link and send it, or mark it sent if you already did.",
      records: unshared.slice(0, 5).map((invoice) => ({ kind: "invoice", id: invoice._id, label: label(invoice), detail: `${money(invoice.totals.balanceCents)} requested`, amountCents: invoice.totals.balanceCents })),
      action: { label: "Open the invoice", kind: "open_invoice" },
      totalCents: null,
    });
  }

  const drafts = invoices.filter((invoice) => invoice.status === "draft" && now - invoice.createdAt > 2 * 86_400_000);
  if (drafts.length) {
    out.push({
      id: "drafts",
      tone: "info",
      state: "needs_your_approval",
      title: `${plural(drafts.length, "draft")} waiting to be issued`,
      noticed: `${plural(drafts.length, "draft")} totaling ${money(drafts.reduce((s, invoice) => s + invoice.totals.totalCents, 0))} ${drafts.length === 1 ? "has" : "have"} been waiting more than two days.`,
      recommend: "Review each draft and issue it, or discard it.",
      records: drafts.slice(0, 5).map((invoice) => ({ kind: "invoice", id: invoice._id, label: label(invoice), detail: `${money(invoice.totals.totalCents)} draft`, amountCents: invoice.totals.totalCents })),
      action: { label: "See drafts", kind: "filter_invoices", filter: "drafts" },
      totalCents: drafts.reduce((s, invoice) => s + invoice.totals.totalCents, 0),
    });
  }

  if (input.stripe.state === "not_connected" || input.stripe.state === "onboarding" || input.stripe.state === "restricted" || input.stripe.state === "disconnected") {
    out.push({
      id: "stripe",
      tone: input.stripe.state === "restricted" ? "warning" : "info",
      state: "needs_attention",
      title: input.stripe.state === "restricted" ? "Stripe needs something from you" : input.stripe.state === "onboarding" ? "Finish setting up Stripe" : "Take card payments",
      noticed:
        input.stripe.state === "restricted"
          ? (input.stripe.problem ?? "Stripe has paused card payments until it gets more information.")
          : input.stripe.state === "onboarding"
            ? "Your Stripe account isn't finished, so customers can't pay by card yet."
            : "Customers can only pay you outside Selestial right now. You can still record those payments here.",
      recommend: input.stripe.state === "restricted" ? "Open Stripe and give it what it asks for." : "Connect your own Stripe account. The money goes to you; Selestial never holds it.",
      records: [],
      action: { label: input.stripe.state === "not_connected" || input.stripe.state === "disconnected" ? "Set up payments" : "Continue in Stripe", kind: "open_setup" },
      totalCents: null,
    });
  }

  // The most serious first: money disputed or past due, then problems, then housekeeping.
  const rank = { danger: 0, warning: 1, info: 2 } as const;
  return out.map((finding, index) => ({ finding, index })).sort((a, b) => rank[a.finding.tone] - rank[b.finding.tone] || a.index - b.index).map((row) => row.finding);
}
