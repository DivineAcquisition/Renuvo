/**
 * What a message's fate means for the application it was about. Delivery is its own record (the
 * message row); this file is the only place it is allowed to move an application.
 *
 * An invitation is "invited" only once the email service accepted it. One that bounced or never went
 * was never an invitation the applicant ignored: no reminder follows it and nothing counts against
 * them. It becomes "contact needed" and a person's task.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { askPerson, isActive, setStage, SYSTEM } from "./applications";
import { DAY } from "./settings";

/** `accepted`: the provider took it. `delivered`: a later report that it arrived. `failed`: it did not go, or nobody knows. */
export async function afterApplicantMessage(ctx: MutationCtx, message: Doc<"messages">, event: "accepted" | "delivered" | "failed"): Promise<void> {
  if (!message.applicationId || event === "delivered") return;
  const application = await ctx.db.get(message.applicationId);
  if (!application || !isActive(application)) return;
  const applicant = await ctx.db.get(application.applicantId);
  const who = applicant?.name ?? "an applicant";
  const email = message.channel === "email";

  if (event === "accepted") {
    if (message.purpose === "application_invitation" && email) {
      const link = message.applicantLinkId ? await ctx.db.get(message.applicantLinkId) : null;
      const next = { what: "Complete the application form", by: "applicant" as const, dueAt: link?.expiresAt };
      if (application.stage === "received" || application.stage === "contact_needed" || application.stage === "invitation_awaiting_approval") await setStage(ctx, application, "invited", SYSTEM, { invitedAt: application.invitedAt ?? Date.now(), nextAction: next });
      // An invitation a person sent again restarts the reminder clock from when it went.
      else if (application.stage === "invited" || application.stage === "application_started") await ctx.db.patch(application._id, { invitedAt: application.invitedAt ?? Date.now(), nextAction: next });
    }
    // A reminder counts once the email service has taken it, not when it was planned.
    if (message.purpose === "application_follow_up" && email) await ctx.db.patch(application._id, { followUpsSent: application.followUpsSent + 1 });
    return;
  }
  if (message.status !== "failed" && message.status !== "unconfirmed") return;
  // A text that failed is noted on the message. Email is the channel the workflow stands on.
  if (!email) return;

  const bounced = message.bouncedAt !== undefined;
  const unknown = message.status === "unconfirmed";
  const what = unknown
    ? "An email was started and never confirmed, so it is not known whether it went. It was not sent again."
    : bounced
      ? `The email to ${application.contact.address ?? "the address on file"} bounced.`
      : `An email could not be sent. ${message.problem ?? ""}`.trim();
  if (bounced) await ctx.db.patch(application._id, { contact: { ...application.contact, bouncedAt: Date.now() } });
  const fresh = (await ctx.db.get(application._id))!;
  const next = { what: `${what} ${unknown ? "Check with the applicant before anything else is sent." : "Correct the address, or reach them another way."}`, by: "owner" as const, dueAt: Date.now() + DAY };
  if (bounced && (fresh.stage === "received" || fresh.stage === "invitation_awaiting_approval" || fresh.stage === "invited" || fresh.stage === "application_started")) {
    await setStage(ctx, fresh, "contact_needed", SYSTEM, { nextAction: next });
  } else {
    await ctx.db.patch(fresh._id, { nextAction: next });
  }
  await askPerson(ctx, fresh, {
    what: bounced ? "contact" : "delivery",
    title: bounced ? `Email to ${who} bounced` : `An email to ${who} did not go`,
    question: next.what,
    dueAt: next.dueAt,
    completionCondition: "The applicant can be reached, or the application was closed",
    actor: SYSTEM,
  });
}
