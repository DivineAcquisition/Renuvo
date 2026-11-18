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

/** Where a prepared customer message is. After "approved" the outbox row says what happened. */
export const FINANCE_MESSAGE_STATUSES = ["draft", "approved", "skipped", "stale"] as const;
export type FinanceMessageStatus = (typeof FINANCE_MESSAGE_STATUSES)[number];
export const financeMessageStatusValidator = literals(FINANCE_MESSAGE_STATUSES);

/** The reminder schedule, plus a message a person asked for. */
export const FINANCE_MESSAGE_STAGES = ["invoice", "before_due", "overdue_1", "overdue_7", "overdue_14", "manual"] as const;
export type FinanceMessageStage = (typeof FINANCE_MESSAGE_STAGES)[number];
export const financeMessageStageValidator = literals(FINANCE_MESSAGE_STAGES);

/**
 * A cleaner's earnings for one job, kept apart at every step (owner's decision, phase 3):
 * calculated → needs_review → approved → payment_started → paid. Approval is never proof of payment;
 * "paid" needs an explicit confirmation from the Owner. "void" is a job whose assignment was undone.
 */
export const EARNING_STATUSES = ["calculated", "needs_review", "approved", "payment_started", "paid", "void"] as const;
export type EarningStatus = (typeof EARNING_STATUSES)[number];
export const earningStatusValidator = literals(EARNING_STATUSES);

export const TEAM_PAY_METHODS = ["zelle", "venmo", "cash", "check", "bank_transfer", "payroll", "other"] as const;
export type TeamPayMethod = (typeof TEAM_PAY_METHODS)[number];
export const teamPayMethodValidator = literals(TEAM_PAY_METHODS);

/**
 * An expense, as stored. "to_review" is a draft Selestial prepared (from a receipt, a statement row or an
 * unfinished manual entry) that waits for the Owner; "recorded" is in the books, put there by the Owner or
 * by one of the Owner's own rules; "void" was set aside with a reason. Nothing is deleted.
 */
export const EXPENSE_STATUSES = ["to_review", "recorded", "void"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const expenseStatusValidator = literals(EXPENSE_STATUSES);

/** Where an expense came from. */
export const EXPENSE_SOURCES = ["receipt", "manual", "statement", "gmail", "cleaner"] as const;
export const expenseSourceValidator = literals(EXPENSE_SOURCES);

/** What paid for it. "personal" means the Owner paid out of pocket and is owed it back. */
export const PAID_WITH = ["business_card", "bank", "cash", "personal", "other"] as const;
export type PaidWith = (typeof PAID_WITH)[number];
export const paidWithValidator = literals(PAID_WITH);

/** What an expense is for: one visit, one property, one service, or the business in general. */
export const expenseLinkValidator = v.union(
  v.object({ kind: v.literal("job"), jobId: v.id("jobs") }),
  v.object({ kind: v.literal("property"), propertyId: v.id("properties") }),
  v.object({ kind: v.literal("service"), serviceKey: v.string() }),
  v.object({ kind: v.literal("overhead") }),
);

/** A category the company files expenses under. Job costs can be linked to a visit; overhead can't. */
export const expenseCategoryValidator = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.union(v.literal("job"), v.literal("overhead")),
  /** The Services & Pricing estimate this compares to in Profitability. */
  costKey: v.optional(v.union(v.literal("supplies"), v.literal("travel"), v.literal("equipment"), v.literal("laundry"))),
  /** The QuickBooks account it goes to when that sync is built. */
  accountName: v.optional(v.string()),
  hidden: v.optional(v.boolean()),
});

/** One field read from a receipt: the value, and whether it could be read clearly. */
const readNumber = v.object({ value: v.union(v.number(), v.null()), clear: v.boolean() });
const readText = v.object({ value: v.union(v.string(), v.null()), clear: v.boolean() });

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
    /** Selestial prepares reminder drafts on the schedule (3 days before, then 1, 7 and 14 days after). Absent means on. */
    remindersOn: v.optional(v.boolean()),
    /** Where customers' replies to invoice and reminder emails go. Absent means the Owner's email. */
    replyTo: v.optional(v.string()),
    /** Customers may add a tip on the pay page, all of it for the job's cleaners. Absent means on. */
    tipsOn: v.optional(v.boolean()),
    /** The categories expenses are filed under. Absent means the cleaning-business set in code. */
    expenseCategories: v.optional(v.array(expenseCategoryValidator)),
    /** The next number to give an invoice when it is issued. Drafts have no number. */
    nextInvoiceNumber: v.number(),
    invoicePrefix: v.string(),
    revision: v.number(),
    /** Absent when the row was first made by an online booking taking the next invoice number. */
    updatedBy: v.optional(v.id("members")),
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
    /** `by` is absent when Selestial voided it itself (a booking whose price changed before it was paid). */
    voided: v.optional(v.object({ at: v.number(), by: v.optional(v.id("members")), reason: v.string() })),
    paidAt: v.optional(v.number()),
    /** The member who made it. Absent on an invoice a customer's online booking made (`bookingSessionId`). */
    createdBy: v.optional(v.id("members")),
    /** The online booking this invoice collects for (convex/lib/booking/payments.ts). */
    bookingSessionId: v.optional(v.id("bookingSessions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_company_customer", ["companyId", "customerId", "createdAt"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_issued", ["companyId", "issuedAt"])
    .index("by_company_due", ["companyId", "status", "dueAt"])
    .index("by_status_due", ["status", "dueAt"])
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
    /** A tip paid with this payment, on top of `amountCents`. It is the cleaners', never the invoice's. */
    tipCents: v.optional(v.number()),
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
   * A message to a customer about an invoice that Selestial prepared (or the Owner started) and a person
   * approves before it goes. Approving hands it to the shared outbox as a `messages` row, where the
   * sending policy decides; what happened after that is read from that row, never copied here.
   */
  financeMessages: defineTable({
    companyId: v.id("companies"),
    invoiceId: v.id("invoices"),
    customerId: v.id("customers"),
    kind: v.union(v.literal("invoice"), v.literal("reminder")),
    /** Which step of the schedule this is, so the same step is never prepared twice for one invoice. */
    stage: financeMessageStageValidator,
    channel: v.union(v.literal("email"), v.literal("sms")),
    subject: v.optional(v.string()),
    /** With "{link}" where the pay link goes. The link is made when the message is sent. */
    body: v.string(),
    status: financeMessageStatusValidator,
    /** Why it was set aside: skipped by the Owner, or no longer needed, in words. */
    closedReason: v.optional(v.string()),
    /** The Owner changed the text Selestial wrote. A change in what is owed then waits for them, not for Selestial. */
    edited: v.boolean(),
    /** What the invoice said when the text was written. A different answer later means the text may be wrong. */
    basis: v.object({ requestedCents: v.number(), dueAt: v.union(v.number(), v.null()), state: v.string() }),
    preparedBy: v.union(v.object({ kind: v.literal("selestial") }), v.object({ kind: v.literal("member"), memberId: v.id("members") })),
    approvedBy: v.optional(v.id("members")),
    approvedAt: v.optional(v.number()),
    messageId: v.optional(v.id("messages")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_company_invoice", ["companyId", "invoiceId", "createdAt"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /**
   * One cleaner's earnings for one job. Worked out by code from the cleaner's pay method, the job's price
   * and the hours they worked (check-in to submitting the job complete). The Owner's corrections and
   * adjustments are kept with their reasons. After approval, a change that would alter the total sends
   * it back to review; once a payment is started nothing here changes.
   */
  earnings: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    jobId: v.id("jobs"),
    assignmentId: v.id("assignments"),
    status: earningStatusValidator,
    method: v.union(v.literal("share"), v.literal("tier"), v.literal("fixed"), v.literal("hourly"), v.literal("none")),
    /**
     * The pay method as it was when this job was first worked out, kept so a later change to the
     * cleaner's rate or to a tier's share never rewrites past pay. Absent until a method applied.
     */
    payUsed: v.optional(
      v.union(
        v.object({ kind: v.literal("share"), shareBps: v.number(), tierName: v.optional(v.string()) }),
        v.object({ kind: v.literal("hourly"), hourlyCents: v.number() }),
        v.object({ kind: v.literal("fixed"), perJobCents: v.number() }),
      ),
    ),
    /** How the pay was worked out, in words: "Proven tier, 40% of the $240.00 job price". */
    basis: v.string(),
    facts: v.object({
      priceCents: v.union(v.number(), v.null()),
      crewSize: v.number(),
      lead: v.boolean(),
      scheduledMinutes: v.number(),
      /** From check-in to submitting the job complete. Null when either is missing. */
      workedMinutes: v.union(v.number(), v.null()),
      /** The minutes the pay used, and where they came from. */
      paidMinutes: v.number(),
      minutesSource: v.union(v.literal("worked"), v.literal("scheduled"), v.literal("corrected")),
      /** What the cleaner was told when they took the job. */
      offeredCents: v.number(),
      checkInAt: v.union(v.number(), v.null()),
      completedAt: v.union(v.number(), v.null()),
    }),
    /** Null when it can't be worked out (no pay method, no job price). Never a guessed zero. */
    baseCents: v.union(v.number(), v.null()),
    hoursCorrection: v.optional(v.object({ minutes: v.number(), reason: v.string(), by: v.id("members"), at: v.number() })),
    adjustments: v.array(v.object({ id: v.string(), cents: v.number(), reason: v.string(), by: v.id("members"), at: v.number(), reversed: v.optional(v.object({ at: v.number(), by: v.id("members"), reason: v.string() })) })),
    /** Tips allocated to this cleaner for this job, from tips that were received. */
    tipCents: v.number(),
    /** The tips covered by payments already recorded. A tip that arrives later is owed on its own. */
    tipsPaidCents: v.optional(v.number()),
    totalCents: v.union(v.number(), v.null()),
    /** Why it needs the Owner's review, in words. Empty means it can be approved as calculated. */
    flags: v.array(v.string()),
    approved: v.optional(v.object({ by: v.id("members"), at: v.number(), totalCents: v.number() })),
    paymentId: v.optional(v.id("teamPayments")),
    voidReason: v.optional(v.string()),
    jobStartsAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "jobStartsAt"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "jobStartsAt"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_assignment", ["companyId", "assignmentId"]),

  /**
   * A payment to a cleaner, for one or more approved earnings. Recorded by the Owner: "started" when the
   * money is on its way (a transfer sent, a check handed over, payroll run), "paid" only when they
   * confirm it arrived. Selestial does not move this money.
   */
  teamPayments: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    /** What this payment covers: each earning's job pay and tips, so canceling it puts each back exactly. */
    parts: v.array(v.object({ earningId: v.id("earnings"), jobCents: v.number(), tipCents: v.number() })),
    amountCents: v.number(),
    method: teamPayMethodValidator,
    status: v.union(v.literal("started"), v.literal("paid"), v.literal("canceled")),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    startedAt: v.number(),
    /** The day the Owner says it was paid, on the company's clock. */
    paidOn: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    canceled: v.optional(v.object({ at: v.number(), by: v.id("members"), reason: v.string() })),
    recordedBy: v.id("members"),
    clientKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "createdAt"])
    .index("by_company_clientKey", ["companyId", "clientKey"]),

  /**
   * A tip for a job's cleaners: added by the customer on the pay page (counted once the card payment is
   * received) or recorded by the Owner. All of it is the cleaners', split evenly across the crew.
   */
  tips: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    invoiceId: v.optional(v.id("invoices")),
    paymentId: v.optional(v.id("payments")),
    amountCents: v.number(),
    source: v.union(v.literal("pay_page"), v.literal("recorded")),
    status: v.union(v.literal("pending"), v.literal("received"), v.literal("refunded")),
    allocations: v.array(v.object({ cleanerId: v.id("cleaners"), cents: v.number() })),
    note: v.optional(v.string()),
    recordedBy: v.optional(v.id("members")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_payment", ["companyId", "paymentId"]),

  /**
   * A cleaner's private link to their own earnings statement. The token is the public id plus a
   * signature; it is never stored. Issuing a new link revokes the old one.
   */
  statementLinks: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    publicId: v.string(),
    issuedBy: v.id("members"),
    issuedAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "issuedAt"]),

  /**
   * An amount the customer no longer owes on an issued invoice, with the reason. No money moves. A
   * credit given by mistake is reversed with a reason, never removed.
   */
  /**
   * The company's expenses. Amounts are what was paid, tax included, in whole cents. A field Selestial read
   * from a receipt is only a suggestion until the Owner records the expense or one of their rules files it.
   */
  expenses: defineTable({
    companyId: v.id("companies"),
    status: expenseStatusValidator,
    source: expenseSourceValidator,
    vendor: v.optional(v.string()),
    /** The vendor in a form that matches across spellings ("home depot"), for rules, history and duplicates. */
    vendorKey: v.optional(v.string()),
    /** The calendar day it was paid, on the company's clock. Absent until known. */
    spentOn: v.optional(v.string()),
    /** What was paid, tax included. Absent until known; never guessed as zero. */
    amountCents: v.optional(v.number()),
    /** Sales tax shown on the receipt, when there is one. */
    taxCents: v.optional(v.number()),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    /** Who chose the category: a person, or one of the Owner's rules. */
    categoryBy: v.optional(v.union(v.literal("person"), v.literal("rule"))),
    /** Selestial's suggestion, kept apart until a person accepts it or a rule covers it. */
    suggestion: v.optional(v.object({ categoryId: v.string(), why: v.string(), from: v.union(v.literal("history"), v.literal("receipt")) })),
    link: v.optional(expenseLinkValidator),
    /** The linked visit, kept beside `link` so a visit's costs can be found by index. */
    jobId: v.optional(v.id("jobs")),
    jobSuggestion: v.optional(v.object({ jobId: v.id("jobs"), why: v.string() })),
    paidWith: v.optional(paidWithValidator),
    /** "Card ending 4242", "Chase checking". Plain words only. */
    paidWithNote: v.optional(v.string()),
    /** For an expense paid personally: when the business paid the Owner back. */
    repaid: v.optional(v.object({ on: v.string(), at: v.number(), by: v.id("members") })),
    receiptId: v.optional(v.id("expenseReceipts")),
    importId: v.optional(v.id("expenseImports")),
    /** One statement row's identity, so importing the same file twice adds nothing twice. */
    importKey: v.optional(v.string()),
    /** The statement row this expense was matched to, as the bank wrote it. */
    statementLine: v.optional(v.object({ description: v.string(), amountCents: v.number(), on: v.string(), importId: v.id("expenseImports") })),
    /** Fields from the receipt that couldn't be read clearly. The Owner checks these before recording. */
    unclear: v.optional(v.array(v.string())),
    /** A recorded expense this one may repeat, and whether the Owner said it isn't a repeat. */
    duplicateOf: v.optional(v.id("expenses")),
    duplicateCleared: v.optional(v.boolean()),
    /** The Owner's rule that filed it, when one did. */
    ruleId: v.optional(v.id("expenseRules")),
    recordedAt: v.optional(v.number()),
    recordedBy: v.optional(v.union(v.object({ kind: v.literal("member"), memberId: v.id("members") }), v.object({ kind: v.literal("rule"), ruleId: v.id("expenseRules") }))),
    voided: v.optional(v.object({ at: v.number(), by: v.id("members"), reason: v.string() })),
    /** A browser's key for one "add", so a repeated click adds once. */
    clientKey: v.optional(v.string()),
    revision: v.number(),
    createdBy: v.optional(v.id("members")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status_spent", ["companyId", "status", "spentOn"])
    .index("by_company_spent", ["companyId", "spentOn"])
    .index("by_company_amount", ["companyId", "amountCents"])
    .index("by_company_vendor", ["companyId", "vendorKey"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_import_key", ["companyId", "importKey"])
    .index("by_company_receipt", ["companyId", "receiptId"])
    .index("by_company_clientKey", ["companyId", "clientKey"]),

  /**
   * A receipt file: a photo or PDF the Owner uploaded. Selestial reads it once and keeps what it read
   * beside the file; the expense holds what the Owner accepted. The file is never changed.
   */
  expenseReceipts: defineTable({
    companyId: v.id("companies"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    /** The file's fingerprint, so the same receipt uploaded twice is noticed. */
    sha256: v.optional(v.string()),
    source: v.union(v.literal("upload"), v.literal("gmail"), v.literal("cleaner")),
    uploadedBy: v.optional(v.id("members")),
    reading: v.object({
      state: v.union(v.literal("pending"), v.literal("read"), v.literal("failed"), v.literal("not_available"), v.literal("not_a_receipt")),
      note: v.optional(v.string()),
      at: v.optional(v.number()),
      fields: v.optional(
        v.object({
          vendor: readText,
          date: readText,
          totalCents: readNumber,
          taxCents: readNumber,
          paidWith: readText,
          items: v.optional(v.string()),
          categoryName: v.optional(v.string()),
          categoryWhy: v.optional(v.string()),
        }),
      ),
    }),
    expenseId: v.optional(v.id("expenses")),
    createdAt: v.number(),
  })
    .index("by_company_sha", ["companyId", "sha256"])
    .index("by_storage", ["storageId"]),

  /**
   * The Owner's own filing rules: "anything from Home Depot is Supplies". A rule that auto-files records a
   * matching expense only when its vendor, date and amount were read clearly and it isn't a possible repeat;
   * otherwise the rule's category is shown as a suggestion.
   */
  expenseRules: defineTable({
    companyId: v.id("companies"),
    /** Matched against the vendor's normalized name: "home depot" matches "The Home Depot #4521". */
    vendorContains: v.string(),
    categoryId: v.string(),
    paidWith: v.optional(paidWithValidator),
    autoFile: v.boolean(),
    active: v.boolean(),
    matches: v.number(),
    lastMatchedAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_company", ["companyId"]),

  /** One bank or card statement brought in from a CSV file. The rows become expenses or match existing ones. */
  expenseImports: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    paidWith: paidWithValidator,
    paidWithNote: v.optional(v.string()),
    rows: v.number(),
    added: v.number(),
    matched: v.number(),
    skipped: v.number(),
    clientKey: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_clientKey", ["companyId", "clientKey"]),

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
