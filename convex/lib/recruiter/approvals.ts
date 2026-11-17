/**
 * What a person's decision on one of Recruiter's proposals sets in motion. Approving never just "sends
 * what was proposed": every check runs again at that moment, against the record as it is then, and the
 * answer says whether the action was carried out and why not if it was not.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { CarriedOut } from "../dispatch/workflow";
import type { Actor } from "../events";
import { afterDeclineDecision } from "./decisions";
import { afterInterviewInviteDecision } from "./interviews";
import { afterInvitationDecision, afterInvitationExpiry, sendFollowUp } from "./invitations";
import { afterOfferDecision } from "./offers";
import { sendInformationRequest } from "./screening";
import { sendUrgentOutreach } from "./urgent";
import { sendOnboardingReminder } from "../workforce/reminders";

export const RECRUITER_PROPOSALS = ["send_invitation", "send_follow_up", "request_information", "invite_to_interview", "send_hiring_offer", "decline_application", "urgent_outreach", "send_onboarding_reminder"] as const;

export function isRecruiterProposal(approval: Pick<Doc<"approvals">, "proposal">): boolean {
  return approval.proposal !== undefined && (RECRUITER_PROPOSALS as readonly string[]).includes(approval.proposal.kind);
}

async function record(ctx: MutationCtx, approval: Doc<"approvals">, result: CarriedOut | null): Promise<CarriedOut | null> {
  if (result) await ctx.db.patch(approval._id, { carriedOut: { ...result, at: Date.now() } });
  return result;
}

export async function afterRecruiterDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  const proposal = approval.proposal;
  if (!proposal) return null;
  const approved = decision === "approved";
  switch (proposal.kind) {
    case "send_invitation":
      return record(ctx, approval, await afterInvitationDecision(ctx, approval, proposal.applicationId, decision, decidedBy));
    case "send_follow_up":
      return record(ctx, approval, approved ? await sendFollowUp(ctx, proposal.applicationId, proposal.attempt, decidedBy) : null);
    case "request_information":
      return record(ctx, approval, approved ? await sendInformationRequest(ctx, proposal.applicationId, proposal.question, decidedBy) : null);
    case "invite_to_interview":
      return record(ctx, approval, await afterInterviewInviteDecision(ctx, proposal.interviewId, decision, decidedBy));
    case "send_hiring_offer":
      return record(ctx, approval, await afterOfferDecision(ctx, approval, proposal.offerId, decision, decidedBy));
    case "decline_application":
      return record(ctx, approval, await afterDeclineDecision(ctx, approval, proposal.applicationId, proposal.criterion, decision, decidedBy));
    case "urgent_outreach":
      return record(ctx, approval, approved ? await sendUrgentOutreach(ctx, proposal.applicationId, proposal.taskId, decidedBy) : null);
    case "send_onboarding_reminder":
      return record(ctx, approval, approved ? await sendOnboardingReminder(ctx, proposal.cleanerId, proposal.attempt, decidedBy) : null);
    default:
      return null;
  }
}

/** Nobody decided in time. Nothing was sent; the work goes back to be looked at again. */
export async function afterRecruiterExpiry(ctx: MutationCtx, approval: Doc<"approvals">): Promise<void> {
  const proposal = approval.proposal;
  if (proposal?.kind === "send_invitation") await afterInvitationExpiry(ctx, proposal.applicationId);
}
