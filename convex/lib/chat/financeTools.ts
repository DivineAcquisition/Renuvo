/**
 * Company Chat over Finance (docs/finance/00-plan.md, phase 2). The Owner only, like Finance itself.
 * Chat reads invoices and payments and prepares reminder drafts; it never sends, charges, refunds or
 * writes anything off. Every result links to the record it came from, so the conversation and the
 * Finance screens work on the same invoices.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { prepareDraft } from "../finance/collections";
import { amountRequested, depositOutstanding, inDepositStage, invoiceState, STATE_WORDS } from "../finance/invoiceState";
import { invoiceRows, REFUND_COUNTS } from "../finance/ledger";
import { dollars } from "../finance/money";
import { invoiceMessages } from "../finance/outbox";
import { categoryById, categoryByName } from "../finance/categories";
import { localDateKey, settingsOf, settingsRow } from "../finance/settings";
import type { ChatTool, Outcome, ToolCtx } from "./tools";

const DAY = 86_400_000;
const refused = (why: string): Outcome => ({ status: "refused", why });
const invoiceLink = (id: Id<"invoices">, number: string | undefined) => ({ href: `/app/finance?tab=invoices&invoice=${id}`, label: `Open ${number ?? "the invoice"}` });

async function invoiceByRef(ctx: ToolCtx, value: unknown): Promise<Doc<"invoices"> | null> {
  if (typeof value !== "string" || !value.trim()) return null;
  const id = ctx.db.normalizeId("invoices", value.trim());
  if (id) {
    const row = await ctx.db.get(id);
    return row && row.companyId === ctx.company._id ? row : null;
  }
  // An invoice number, as the Owner would say it: "INV-1015".
  const wanted = value.trim().toUpperCase();
  const recent = await ctx.db
    .query("invoices")
    .withIndex("by_company_created", (q) => q.eq("companyId", ctx.company._id))
    .order("desc")
    .take(1000);
  return recent.find((row) => row.number?.toUpperCase() === wanted) ?? null;
}

async function customerName(ctx: ToolCtx, id: Id<"customers">) {
  const row = await ctx.db.get(id);
  return row && row.companyId === ctx.company._id ? row.name : "Customer";
}

export const FINANCE_TOOLS: ChatTool[] = [
  {
    name: "list_expenses",
    label: "Reading the company's expenses",
    description:
      "The company's expenses from its own records for a period: recorded spending by category (job costs and overhead), each expense (date, vendor, amount, category, what paid for it, visit if linked), what is waiting for the Owner to review, and what the Owner paid personally and is owed back. Optionally one category. Amounts are US dollars, tax included. Card processing fees and cleaner pay are kept elsewhere (on payments and in Team Pay) and are not here. Read only: recording or changing an expense is done by the Owner in Finance.",
    kind: "read",
    minimumRole: "owner",
    input: {
      type: "object",
      properties: {
        from: { type: "string", max: 10, optional: true, description: "First day, YYYY-MM-DD. Default: the first of this month." },
        to: { type: "string", max: 10, optional: true, description: "Last day, YYYY-MM-DD. Default: today." },
        category: { type: "string", max: 40, optional: true, description: "Only this category, by name (for example Supplies)." },
      },
    },
    run: async (ctx, args) => {
      const tz = ctx.company.timezone;
      const today = localDateKey(Date.now(), tz);
      const from = typeof args.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? args.from : `${today.slice(0, 8)}01`;
      const to = typeof args.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? args.to : today;
      if (from > to) return refused("The first day is after the last day.");
      const settings = settingsOf(await settingsRow(ctx, ctx.company._id));
      const categories = settings.expenseCategories;
      const wanted = typeof args.category === "string" ? categoryByName(categories, args.category) : null;
      if (args.category && !wanted) return refused(`There's no category called "${args.category}". The categories are: ${categories.filter((c) => !c.hidden).map((c) => c.name).join(", ")}.`);
      const recorded = (
        await ctx.db
          .query("expenses")
          .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.company._id).eq("status", "recorded").gte("spentOn", from).lte("spentOn", to))
          .take(2000)
      ).filter((e) => !wanted || e.categoryId === wanted.id);
      const waiting = await ctx.db
        .query("expenses")
        .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.company._id).eq("status", "to_review"))
        .take(500);
      const byCategory = new Map<string, { category: string; kind: string; total: number; count: number }>();
      for (const e of recorded) {
        const c = categoryById(categories, e.categoryId);
        const row = byCategory.get(c?.id ?? "none") ?? { category: c?.name ?? "No category", kind: c?.kind === "job" ? "job cost" : "overhead", total: 0, count: 0 };
        row.total += e.amountCents ?? 0;
        row.count += 1;
        byCategory.set(c?.id ?? "none", row);
      }
      const total = recorded.reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
      const owedBack = (
        await ctx.db
          .query("expenses")
          .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.company._id).eq("status", "recorded"))
          .take(3000)
      ).filter((e) => e.paidWith === "personal" && !e.repaid);
      const PAID: Record<string, string> = { business_card: "business card", bank: "bank account", cash: "cash", personal: "paid personally", other: "other" };
      return {
        status: "done",
        summary: `${dollars(total)} recorded in ${recorded.length} expense${recorded.length === 1 ? "" : "s"}${wanted ? ` for ${wanted.name}` : ""}, ${from} to ${to}`,
        link: { href: "/app/finance?tab=expenses&filter=recorded", label: "Open expenses" },
        data: {
          from,
          to,
          totalRecorded: dollars(total),
          byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total).map((r) => ({ ...r, total: dollars(r.total) })),
          expenses: recorded
            .sort((a, b) => (b.spentOn ?? "").localeCompare(a.spentOn ?? ""))
            .slice(0, 60)
            .map((e) => ({ expenseId: e._id, date: e.spentOn ?? null, vendor: e.vendor ?? null, amount: e.amountCents === undefined ? null : dollars(e.amountCents), category: categoryById(categories, e.categoryId)?.name ?? null, paidWith: e.paidWith ? PAID[e.paidWith] : null, linkedToVisit: Boolean(e.jobId), filedByRule: e.recordedBy?.kind === "rule" })),
          waitingForReview: { count: waiting.length, knownAmount: dollars(waiting.reduce((sum, e) => sum + (e.amountCents ?? 0), 0)), withoutAmountYet: waiting.filter((e) => e.amountCents === undefined).length },
          owedBackToOwner: { total: dollars(owedBack.reduce((sum, e) => sum + (e.amountCents ?? 0), 0)), count: owedBack.length },
          note: "Only recorded expenses are counted as spent. Waiting ones are drafts the Owner hasn't confirmed. Expenses aren't net profit: revenue, cleaner pay and card fees are kept elsewhere.",
        },
      };
    },
  },
  {
    name: "list_unpaid_invoices",
    label: "Reading what customers owe",
    description:
      "Issued invoices that still have money owed, from the company's own records: number, customer, state (requested, deposit requested, partially paid, processing, overdue), what is being asked for now, the balance, the due date and days late. Optionally only overdue ones, or one customer's. Amounts are US dollars. Processing payments are not counted as paid.",
    kind: "read",
    minimumRole: "owner",
    input: {
      type: "object",
      properties: {
        overdueOnly: { type: "boolean", optional: true, description: "Only invoices past their due date." },
        customerId: { type: "string", max: 64, optional: true, description: "Only this customer's (customers id)." },
      },
    },
    run: async (ctx, args) => {
      const now = Date.now();
      const open = await ctx.db
        .query("invoices")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "open"))
        .take(500);
      const customerId = typeof args.customerId === "string" ? ctx.db.normalizeId("customers", args.customerId) : null;
      if (args.customerId && !customerId) return refused("That isn't a customer id in this company.");
      type Row = { invoiceId: Id<"invoices">; number: string | null; customer: string; state: string; askingFor: string; balance: string; processing: string | null; due: string | null; daysLate: number; link: string };
      const rows: Row[] = [];
      for (const invoice of open) {
        if (invoice.totals.balanceCents <= 0) continue;
        if (customerId && invoice.customerId !== customerId) continue;
        const state = invoiceState(invoice, now);
        if (args.overdueOnly && state !== "overdue") continue;
        rows.push({
          invoiceId: invoice._id,
          number: invoice.number ?? null,
          customer: await customerName(ctx, invoice.customerId),
          state: STATE_WORDS[state],
          askingFor: dollars(amountRequested(invoice)),
          balance: dollars(invoice.totals.balanceCents),
          processing: invoice.totals.processingCents ? dollars(invoice.totals.processingCents) : null,
          due: invoice.dueAt ? localDateKey(invoice.dueAt, ctx.company.timezone) : null,
          daysLate: invoice.dueAt && state === "overdue" ? Math.floor((now - invoice.dueAt) / DAY) : 0,
          link: invoiceLink(invoice._id, invoice.number).href,
        });
      }
      rows.sort((a, b) => b.daysLate - a.daysLate);
      const owed = open.filter((invoice) => rows.some((row) => row.invoiceId === invoice._id)).reduce((sum, invoice) => sum + invoice.totals.balanceCents, 0);
      return {
        status: "done",
        summary: `${rows.length} ${args.overdueOnly ? "overdue " : ""}invoice${rows.length === 1 ? "" : "s"} with ${dollars(owed)} owed`,
        link: { href: `/app/finance?tab=invoices&filter=${args.overdueOnly ? "overdue" : "outstanding"}`, label: args.overdueOnly ? "Open overdue invoices" : "Open outstanding invoices" },
        data: { invoices: rows, totalOwed: dollars(owed), note: "Only issued invoices are listed. Drafts are not owed yet." },
      };
    },
  },
  {
    name: "explain_invoice",
    label: "Reading the invoice",
    description:
      "One invoice in full from the record: its lines, tax, total, deposit, every payment (with method, date and whether it cleared), refunds, credits with reasons, what is owed now and why it is in its state, and the messages sent to the customer about it. Takes the invoice id or its number (for example INV-1015).",
    kind: "read",
    minimumRole: "owner",
    input: { type: "object", properties: { invoice: { type: "string", max: 64, description: "The invoice's id, or its number such as INV-1015." } } },
    run: async (ctx, args) => {
      const invoice = await invoiceByRef(ctx, args.invoice);
      if (!invoice) return refused("No such invoice in this company.");
      const now = Date.now();
      const tz = ctx.company.timezone;
      const rows = await invoiceRows(ctx, invoice);
      const messages = await invoiceMessages(ctx, invoice);
      const state = invoiceState(invoice, now);
      return {
        status: "done",
        summary: `${invoice.number ?? "Draft"} for ${await customerName(ctx, invoice.customerId)}: ${STATE_WORDS[state].toLowerCase()}, ${dollars(Math.max(0, invoice.totals.balanceCents))} owed`,
        link: invoiceLink(invoice._id, invoice.number),
        data: {
          number: invoice.number ?? "Draft (not issued)",
          state: STATE_WORDS[state],
          issued: invoice.issuedAt ? localDateKey(invoice.issuedAt, tz) : null,
          due: invoice.dueAt ? localDateKey(invoice.dueAt, tz) : null,
          lines: invoice.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: dollars(line.unitCents), amount: dollars(line.amountCents), taxed: line.taxable })),
          subtotal: dollars(invoice.totals.subtotalCents),
          discounts: dollars(invoice.totals.discountCents),
          tax: dollars(invoice.totals.taxCents),
          total: dollars(invoice.totals.totalCents),
          deposit: invoice.depositCents ? { amount: dollars(invoice.depositCents), stillOwed: dollars(depositOutstanding(invoice)), askingForDepositOnly: inDepositStage(invoice) } : null,
          payments: rows.payments
            .filter((p) => p.status !== "awaiting_customer" && p.status !== "canceled")
            .map((p) => ({ amount: dollars(p.amountCents), status: p.status === "succeeded" ? "received" : p.status, method: p.stripe?.methodLabel ?? p.method, on: localDateKey(p.succeededAt ?? p.createdAt, tz), stripeFee: p.stripe?.feeCents !== undefined ? dollars(p.stripe.feeCents) : null, problem: p.problem ?? null, voidedBecause: p.voided?.reason ?? null })),
          refunds: rows.refunds.map((r) => ({ amount: dollars(r.amountCents), status: REFUND_COUNTS.includes(r.status) ? "returned" : r.status, reason: r.reason })),
          credits: rows.credits.map((c) => ({ amount: dollars(c.amountCents), reason: c.reason, reversed: Boolean(c.reversed) })),
          paid: dollars(invoice.totals.paidCents),
          processing: dollars(invoice.totals.processingCents),
          balance: dollars(invoice.totals.balanceCents),
          askingForNow: dollars(amountRequested(invoice)),
          messagesToCustomer: messages.slice(0, 10).map((m) => ({ purpose: m.purpose === "invoice_sent" ? "invoice" : "reminder", channel: m.channel ?? "sms", status: m.status, on: localDateKey(m.queuedAt, tz), problem: m.problem ?? null })),
          voided: invoice.voided ? { on: localDateKey(invoice.voided.at, tz), reason: invoice.voided.reason } : null,
        },
      };
    },
  },
  {
    name: "prepare_payment_reminders",
    label: "Preparing reminders",
    description:
      "Prepare payment reminder drafts for open invoices, for the Owner to review, edit and approve in Finance. It never sends anything. Give invoice ids or numbers, or overdueOnly to prepare one for every overdue invoice. Returns each draft with its status and a link to review.",
    kind: "draft",
    minimumRole: "owner",
    input: {
      type: "object",
      properties: {
        invoices: { type: "array", items: { type: "string", max: 64 }, maxItems: 25, optional: true, description: "Invoice ids or numbers." },
        overdueOnly: { type: "boolean", optional: true, description: "Prepare one for every overdue invoice." },
      },
    },
    run: async (ctx, args) => {
      const now = Date.now();
      let targets: Doc<"invoices">[] = [];
      if (Array.isArray(args.invoices) && args.invoices.length) {
        for (const ref of args.invoices) {
          const invoice = await invoiceByRef(ctx, ref);
          if (!invoice) return refused(`"${String(ref)}" isn't an invoice in this company.`);
          targets.push(invoice);
        }
      } else if (args.overdueOnly) {
        targets = (
          await ctx.db
            .query("invoices")
            .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "open"))
            .take(500)
        ).filter((invoice) => invoiceState(invoice, now) === "overdue");
      } else {
        return refused("Say which invoices, or ask for every overdue one.");
      }
      const prepared: { number: string | null; customer: string; amount: string; draftId: Id<"financeMessages">; alreadyWaiting: boolean }[] = [];
      const skipped: { number: string; why: string }[] = [];
      for (const invoice of targets) {
        if (invoice.status !== "open" || amountRequested(invoice) === 0) {
          skipped.push({ number: invoice.number ?? "Draft", why: invoice.status === "open" ? "Nothing is being asked for right now." : `It is ${invoice.status}.` });
          continue;
        }
        const result = await prepareDraft(ctx, { invoice, stage: "manual", preparedBy: { kind: "selestial" }, actor: { kind: "member", memberId: ctx.member._id } });
        prepared.push({ number: invoice.number ?? null, customer: await customerName(ctx, invoice.customerId), amount: dollars(amountRequested(invoice)), draftId: result.draftId, alreadyWaiting: !result.created });
      }
      return {
        status: "done",
        summary: `${prepared.length} reminder draft${prepared.length === 1 ? "" : "s"} ready for your review. Nothing was sent.`,
        link: { href: "/app/finance?queue=1", label: "Review in Finance" },
        data: { prepared, skipped, sent: 0, note: "Drafts only. Each one is sent only when the Owner approves its exact words in Finance." },
      };
    },
  },
];
