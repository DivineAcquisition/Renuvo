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

// A company's data export can be downloaded for a day; then its file is deleted.
crons.interval("expire company data exports", { minutes: 15 }, internal.dataRights.expireExports, {});

// Requests to Selestial and deletion records are kept three years after they close (Privacy notice).
crons.daily("delete requests and deletion records past retention", { hourUTC: 7, minuteUTC: 17 }, internal.retention.purge, {});

// Recruiter: the hiring inbox, reminders that are due, interviews coming up, and records past their retention date.
crons.interval("recruiter reads the hiring inboxes", { minutes: 10 }, internal.recruiterInbox.sweep, {});
crons.interval("recruiter follows up on unfinished applications", { minutes: 30 }, internal.recruiter.followUps, {});
crons.interval("recruiter sends interview reminders", { minutes: 15 }, internal.recruiter.interviewReminders, {});
crons.interval("recruiter removes applicant details past retention", { hours: 24 }, internal.recruiter.retention, {});

export default crons;
