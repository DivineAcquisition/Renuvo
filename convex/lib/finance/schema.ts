/**
 * Finance: the cleaning company's own money (docs/finance/00-plan.md). Not Selestial's subscription,
 * which is in convex/lib/billing and never mixes with these tables.
 *
 * Rules every table here keeps:
 *  - Money is whole cents in US dollars. No floats are stored.
 *  - Every row carries `companyId` and is read through an index that starts with it.
 *  - Nothing is deleted. A mistake is corrected by a new row or a recorded reversal with a reason, and
 *    each change writes an event (convex/lib/events.ts), so the history can always be read back.
 *  - A payment's state is what the money did, never what someone hoped: "processing" is not "received",
 *    and an approval or a sent link is not a payment.
 *  - Provider answers are reduced to plain words before they are stored. No raw payload is kept.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the invoice is, as stored. Everything a person reads beside it (requested, partially paid,
 * overdue, processing) is worked out from the invoice, its payments and the clock by
 * convex/lib/finance/invoiceState.ts, so a stored word never disagrees with the money.
 */
export const INVOICE_STATUSES = ["draft", "open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const invoiceStatusValidator = literals(INVOICE_STATUSES);

export const LINE_KINDS = ["service", "item", "discount"] as const;
export const lineKindValidator = literals(LINE_KINDS);

/**
 * One payment's life. "awaiting_customer": a card payment was started on the pay page and the customer
 * has not finished it. "checking": Selestial asked the provider and did not get a clear answer, so it is
 * finding out before anything is tried again. "voided": a manually recorded payment that was entered by
 * mistake, kept with the reason.
 */
export const PAYMENT_STATUSES = ["awaiting_customer", "processing", "succeeded", "failed", "canceled", "checking", "voided"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatusValidator = literals(PAYMENT_STATUSES);

/** How the money came in. Card and bank payments come through the connected Stripe account. */
export const PAYMENT_METHODS = ["card", "bank_debit", "cash", "check", "bank_transfer", "zelle", "venmo", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodValidator = literals(PAYMENT_METHODS);
export const MANUAL_METHODS: readonly PaymentMethod[] = ["cash", "check", "bank_transfer", "zelle", "venmo", "other"];

/**
 * One refund's life. "sending": Selestial is asking Stripe now. "pending": Stripe accepted it and the
 * bank has not finished. "recorded": the Owner returned money outside Stripe and recorded it.
 */
export const REFUND_STATUSES = ["sending", "pending", "succeeded", "failed", "canceled", "checking", "recorded"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const refundStatusValidator = literals(REFUND_STATUSES);

export const STRIPE_ACCOUNT_STATUSES = ["onboarding", "active", "restricted", "disconnected"] as const;
export type StripeAccountStatus = (typeof STRIPE_ACCOUNT_STATUSES)[number];
export const stripeAccountStatusValidator = literals(STRIPE_ACCOUNT_STATUSES);

// ── Shapes ───────────────────────────────────────────────────────────────────────────────────────

export const invoiceLineValidator = v.object({
  /** Chosen when the line is added, so an edit names the line it changes. */
  id: v.string(),
  kind: lineKindValidator,
  description: v.string(),
  /** Up to two decimals, for example 2.5 hours. */
  quantity: v.number(),
  /** Per unit. Negative only on a discount. */
  unitCents: v.number(),
  /** quantity × unit, rounded to the cent. Stored so a line never changes when it is read again. */
  amountCents: v.number(),
  taxable: v.boolean(),
  /** The service this line was made from, when it was. */
  serviceId: v.optional(v.string()),
});
export type InvoiceLine = typeof invoiceLineValidator.type;

/** What the invoice adds up to. Written by recompute (convex/lib/finance/ledger.ts) and nothing else. */
export const invoiceTotalsValidator = v.object({
  subtotalCents: v.number(),
  discountCents: v.number(),
  taxCents: v.number(),
  totalCents: v.number(),
  /** Payments that succeeded. Processing payments are not here. */
  paidCents: v.number(),
  refundedCents: v.number(),
  /** Credits: the amount the customer no longer owes, each with a reason. */
  creditedCents: v.number(),
  /** total − credits − paid + refunded. Below zero means the customer paid more than they owe. */
  balanceCents: v.number(),
  /** Payments still in flight. Never counted as paid. */
  processingCents: v.number(),
});
export type InvoiceTotals = typeof invoiceTotalsValidator.type;

export const financeTables = {
  /** The company's invoice settings. One row per company; absent means the defaults in code. */
  financeSettings: defineTable({
    companyId: v.id("companies"),
    /** Sales tax in basis points (825 is 8.25%). Absent means the company has not set one. */
    taxRateBps: v.optional(v.number()),
    taxLabel: v.optional(v.string()),
    /** Services whose lines are taxed by default. A line can still be changed on a draft. */
    taxableServiceIds: v.array(v.string()),
    /** Days from sending until a request is due. */
    paymentTermsDays: v.number(),
    /** Customers may choose to pay part of what is requested on the pay page. */
    allowPartialPayments: v.boolean(),
    /** A short note printed on every invoice, for example how to pay by check. */
    invoiceNote: v.optional(v.string()),
    /** The next number to give an invoice when it is issued. Drafts have no number. */
    nextInvoiceNumber: v.number(),
    invoicePrefix: v.string(),
    revision: v.number(),
    updatedBy: v.id("members"),
    updatedAt: v.number(),
  }).index("by_company", ["companyId"]),

  /**
   * The company's own Stripe account, connected through Stripe Connect. The money goes to that account;
   * Selestial never holds it. One live row per company; a disconnected row is kept for the history.
   */
  stripeAccounts: defineTable({
    companyId: v.id("companies"),
    /** Stripe's account id. Set once Stripe has made the account. */
    accountId: v.optional(v.string()),
    livemode: v.boolean(),
    status: stripeAccountStatusValidator,
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
    /** How many things Stripe still needs from the company, from its last answer. */
    requirementsDue: v.number(),
    /** Why Stripe has paused the account, in words. */
    problem: v.optional(v.string()),
    businessName: v.optional(v.string()),
    /** Counts account-creation attempts, so a retried creation reuses the same request key. */
    createAttempt: v.number(),
    /** The latest onboarding link Stripe gave, for the Owner who asked. Single use and short lived. */
    onboarding: v.optional(
      v.object({
        state: v.union(v.literal("working"), v.literal("ready"), v.literal("failed")),
        requestedBy: v.id("members"),
        requestedAt: v.number(),
        url: v.optional(v.string()),
        expiresAt: v.optional(v.number()),
        problem: v.optional(v.string()),
      }),
    ),
    connectedBy: v.id("members"),
    createdAt: v.number(),
    /** When Selestial last read the account from Stripe. */
    checkedAt: v.optional(v.number()),
    disconnectedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId", "createdAt"])
    .index("by_account", ["accountId"]),

  /**
   * A bill to a customer. A draft can change freely and has no number. Issuing it gives it a number and
   * a pay link, and freezes its lines: a change after that is a credit or a void, each with a reason.
   *
   * A deposit is part of the same invoice: while less than the deposit has been paid and the balance has
   * not been requested, the pay page asks for the deposit only.
   */
  invoices: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    /** The visit this invoice is for. A job has at most one invoice that is not void. */
    jobId: v.optional(v.id("jobs")),
    number: v.optional(v.string()),
    status: invoiceStatusValidator,
    lines: v.array(invoiceLineValidator),
    /** The tax rate this invoice was made with. Later changes to the settings never reach it. */
    taxRateBps: v.number(),
    taxLabel: v.optional(v.string()),
    totals: invoiceTotalsValidator,
    /** Asked for before the service. Absent means no deposit. */
    depositCents: v.optional(v.number()),
    /** When the rest was asked for. Until then, an invoice with a deposit asks for the deposit only. */
    balanceRequestedAt: v.optional(v.number()),
    /** When the current request is due. */
    dueAt: v.optional(v.number()),
    /** What the customer reads on the invoice. */
    memo: v.optional(v.string()),
    /** Counts saves of a draft, so an older browser tab cannot overwrite a newer save. */
    revision: v.number(),
    /** 128 random bits, given when the invoice is issued. With the deployment's secret it makes the pay link. */
    publicId: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    issuedBy: v.optional(v.id("members")),
    /** How the customer was given the link. Selestial does not email or text customers yet. */
    shared: v.optional(v.object({ how: v.union(v.literal("link_copied"), v.literal("marked_sent")), at: v.number(), by: v.id("members") })),
    voided: v.optional(v.object({ at: v.number(), by: v.id("members"), reason: v.string() })),
    paidAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_company_customer", ["companyId", "customerId", "createdAt"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_issued", ["companyId", "issuedAt"])
    .index("by_company_due", ["companyId", "status", "dueAt"])
    .index("by_publicId", ["publicId"]),

  /**
   * Money a customer paid, or started to pay. A card payment is created when the customer starts paying
   * on the pay page and follows Stripe's answer; a manual payment is recorded by the Owner, who confirms
   * they received it.
   */
  payments: defineTable({
    companyId: v.id("companies"),
    invoiceId: v.id("invoices"),
    customerId: v.id("customers"),
    amountCents: v.number(),
    method: paymentMethodValidator,
    source: v.union(v.literal("stripe"), v.literal("manual")),
    status: paymentStatusValidator,
    /** Chosen by the browser for one attempt, so a double click or a retried request makes one payment. */
    clientKey: v.string(),
    stripe: v.optional(
      v.object({
        accountId: v.string(),
        livemode: v.boolean(),
        paymentIntentId: v.optional(v.string()),
        /** Only while the customer is paying. Cleared as soon as the payment settles either way. */
        clientSecret: v.optional(v.string()),
        /** Stripe's processing fee, once Stripe reports it. */
        feeCents: v.optional(v.number()),
        /** "Visa ending 4242", when Stripe says. */
        methodLabel: v.optional(v.string()),
        /** How many times Selestial asked Stripe to create this payment, with the same request key each time. */
        createTries: v.number(),
      }),
    ),
    manual: v.optional(
      v.object({
        /** The day the Owner says the money arrived, on the company's clock ("2026-11-17"). */
        receivedOn: v.string(),
        reference: v.optional(v.string()),
        note: v.optional(v.string()),
        recordedBy: v.id("members"),
      }),
    ),
    /** Why it failed or could not be confirmed, in words for a person. */
    problem: v.optional(v.string()),
    /** Refunds that went through, so the payment shows what is left to refund. */
    refundedCents: v.number(),
    dispute: v.optional(v.object({ status: v.string(), amountCents: v.number(), at: v.number() })),
    voided: v.optional(v.object({ at: v.number(), by: v.id("members"), reason: v.string() })),
    succeededAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    /** When Selestial last asked Stripe about it. */
    checkedAt: v.optional(v.number()),
  })
    .index("by_company_invoice", ["companyId", "invoiceId", "createdAt"])
    .index("by_company_customer", ["companyId", "customerId", "createdAt"])
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_succeeded", ["companyId", "succeededAt"])
    .index("by_company_clientKey", ["companyId", "clientKey"])
    .index("by_intent", ["stripe.paymentIntentId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /** Money given back on one payment. A Stripe refund follows Stripe's answer; a manual one is recorded. */
  refunds: defineTable({
    companyId: v.id("companies"),
    paymentId: v.id("payments"),
    invoiceId: v.id("invoices"),
    customerId: v.id("customers"),
    amountCents: v.number(),
    reason: v.string(),
    status: refundStatusValidator,
    /** Whether the customer also owes less by the same amount. Recorded as a credit with the same reason. */
    alsoCredit: v.boolean(),
    stripeRefundId: v.optional(v.string()),
    tries: v.number(),
    problem: v.optional(v.string()),
    requestedBy: v.id("members"),
    clientKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_company_payment", ["companyId", "paymentId"])
    .index("by_company_invoice", ["companyId", "invoiceId"])
    .index("by_company_clientKey", ["companyId", "clientKey"])
    .index("by_company_settled", ["companyId", "settledAt"])
    .index("by_stripe_refund", ["stripeRefundId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /**
   * An amount the customer no longer owes on an issued invoice, with the reason. No money moves. A
   * credit given by mistake is reversed with a reason, never removed.
   */
  invoiceCredits: defineTable({
    companyId: v.id("companies"),
    invoiceId: v.id("invoices"),
    customerId: v.id("customers"),
    amountCents: v.number(),
    reason: v.string(),
    /** The refund this credit came with, when it did. */
    refundId: v.optional(v.id("refunds")),
    by: v.id("members"),
    at: v.number(),
    reversed: v.optional(v.object({ at: v.number(), by: v.id("members"), reason: v.string() })),
  })
    .index("by_company_invoice", ["companyId", "invoiceId"])
    .index("by_company_customer", ["companyId", "customerId", "at"]),
};
