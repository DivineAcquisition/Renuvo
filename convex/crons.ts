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

// A text whose send started and never finished is marked unconfirmed, never quietly sent again.
crons.interval("find sends that never finished", { minutes: 5 }, internal.messaging.sweepStuck, {});

export default crons;
