import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Deadlines are kept by the system, not by a page someone has open.
crons.interval("expire unanswered offers", { minutes: 5 }, internal.assignments.expireDue, {});
crons.interval("expire undecided approvals", { minutes: 15 }, internal.approvals.expireDue, {});

// Dispatch looks over the coming days for visits that still have no cleaner.
crons.interval("dispatch looks for uncovered visits", { minutes: 15 }, internal.dispatch.sweep, {});

// The day of service: reminders that are due, arrivals that are overdue, visits running over.
crons.interval("dispatch watches the day of service", { minutes: 5 }, internal.dispatchOps.monitor, {});

// Finance: card payments and refunds still in flight are read back from Stripe when its notification is late,
// and payments a customer started and abandoned are stopped. Nothing is ever charged or refunded again here.
crons.interval("finance reconciles payments with Stripe", { minutes: 10 }, internal.financeStripe.reconcile, {});
// Finance: Selestial prepares the payment reminders each open invoice is due for. It prepares only; a person approves every send.
crons.interval("finance prepares payment reminders", { hours: 1 }, internal.financeMessages.sweep, {});
// Finance: completed jobs get each cleaner's earnings worked out. Nothing is approved or paid here.
crons.interval("finance works out team earnings", { minutes: 15 }, internal.teamPay.sweep, {});

// A text whose send started and never finished is marked unconfirmed, never quietly sent again.
crons.interval("find sends that never finished", { minutes: 5 }, internal.messaging.sweepStuck, {});
// The Monday summary at 7 AM company time, and reminders two hours before a proposal's deadline.
crons.interval("notices: weekly summary and approval reminders", { hours: 1 }, internal.notifications.hourly, {});

// A company's data export can be downloaded for a day; then its file is deleted.
crons.interval("expire company data exports", { minutes: 15 }, internal.dataRights.expireExports, {});

// Requests to Selestial and deletion records are kept three years after they close (Privacy notice).
crons.daily("delete requests and deletion records past retention", { hourUTC: 7, minuteUTC: 17 }, internal.retention.purge, {});

// Recruiter: the hiring inbox, reminders that are due, interviews coming up, and records past their retention date.
crons.interval("recruiter reads the hiring inboxes", { minutes: 10 }, internal.recruiterInbox.sweep, {});
crons.interval("recruiter follows up on unfinished applications", { minutes: 30 }, internal.recruiter.followUps, {});
crons.interval("recruiter sends interview reminders", { minutes: 15 }, internal.recruiter.interviewReminders, {});
crons.interval("recruiter removes applicant details past retention", { hours: 24 }, internal.recruiter.retention, {});

// Company Chat: a response whose worker stopped reporting is closed honestly instead of spinning forever.
crons.interval("chat closes interrupted responses", { minutes: 2 }, internal.chatRuns.sweep, {});

// Agreements: signing requests past their expiry are closed, renewal dates open a task for a person (never a renewal), and abandoned uploads are removed.
crons.interval("expire agreement signing requests", { minutes: 30 }, internal.agreementSigning.sweep, {});
crons.daily("remind about agreement renewals and expiries", { hourUTC: 13, minuteUTC: 11 }, internal.agreementRenewals.sweep, {});
// Service plans keep their visits booked about four weeks ahead.
crons.daily("service plans book their visits ahead", { hourUTC: 10, minuteUTC: 47 }, internal.servicePlans.bookAll, {});
// Property prices: two weeks before a review or end date the Owner gets a task; past an end date it is marked ended.
crons.daily("remind about property price review and end dates", { hourUTC: 12, minuteUTC: 23 }, internal.propertyPrices.sweep, {});
crons.daily("remove abandoned agreement uploads", { hourUTC: 8, minuteUTC: 29 }, internal.agreementFiles.cleanup, {});
// Creative Studio: a generation whose worker went quiet is followed again (video) or reported (image), never resent.
crons.interval("creative studio follows up quiet generations", { minutes: 5 }, internal.media.sweep, {});
// Billing: settlements that failed are retried, holds left behind by stopped work are released, and work that never reported back is closed.
crons.interval("billing settles and recovers AI work", { minutes: 5 }, internal.billing.sweep, {});

// Google: the job worker, calendar sync and watches, reviews, Local Services leads, conversions, drive times and Gmail watches.
crons.interval("google works its queue", { minutes: 1 }, internal.googleWork.tick, {});
crons.interval("google calendar sync and watches", { minutes: 10 }, internal.googleCalendar.sweep, {});
crons.interval("google business profile reviews", { minutes: 60 }, internal.googleBusiness.sweep, {});
crons.interval("google local services leads", { minutes: 15 }, internal.googleAds.sweepLocalServices, {});
crons.interval("google conversions for booked jobs", { minutes: 30 }, internal.googleAds.sweepConversions, {});
crons.interval("google drive times for coming visits", { minutes: 30 }, internal.googleRoutes.sweep, {});
crons.daily("renew gmail push watches", { hourUTC: 9, minuteUTC: 41 }, internal.recruiterGmailWatch.sweep, {});

// Cleaners: routine follow-ups (each re-checked before it goes) and requirements that pass their validity.
crons.interval("cleaners follow-ups", { minutes: 30 }, internal.cleanerFollowUps.sweep, {});
crons.interval("cleaners requirements that expire", { minutes: 60 }, internal.requirements.expireDue, {});
// Booking Experiences: holds that ended, and sessions customers walked away from.
crons.interval("bookings let go of ended holds", { minutes: 5 }, internal.bookingOps.sweep, {});

// Sales: lapsed holds and Dispatch handoffs that need another try; recurring plans made to their horizon.
crons.interval("sales bookings sweep", { minutes: 10 }, internal.bookings.sweep, {});
crons.interval("recurring plans make their visits", { hours: 6 }, internal.plans.sweep, {});
crons.interval("proposals past their expiry", { hours: 1 }, internal.proposals.sweep, {});
crons.interval("sales follow-up reminders", { minutes: 30 }, internal.pipeline.sweep, {});
// The Sales agent: runs that never finished, overdue next steps, expired quotes, and reminders whose timer was lost.
crons.interval("sales agent picks up what a missed trigger left", { minutes: 5 }, internal.salesAgent.sweep, {});

// Retention: reconciles plans, visits, billing and agreements; reads back handoffs; closes questions nobody answered; retries unfinished work.
crons.interval("retention reconciles and follows through", { minutes: 10 }, internal.retentionWork.sweep, {});

export default crons;
