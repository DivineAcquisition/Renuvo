import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Deadlines are kept by the system, not by a page someone has open.
crons.interval("expire unanswered offers", { minutes: 5 }, internal.assignments.expireDue, {});
crons.interval("expire undecided approvals", { minutes: 15 }, internal.approvals.expireDue, {});

export default crons;
