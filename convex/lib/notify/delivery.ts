/**
 * What a delivery problem means for the address it happened on (docs/email/00-architecture.md §1, §6).
 * Bounce, complaint and the provider's own suppression are kept apart, and each stops the right mail:
 *
 *  - Selestial's notices to a member: the address goes on `noticeSuppressions`, across companies.
 *  - A company's email to its people: the address goes on that company's do-not-contact list
 *    (`suppressions`), for every kind of email, with the reason. A person can lift it.
 *
 * A failure that says nothing about the address (the service was down) suppresses nothing.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { addSuppression } from "../compliance/permissions";
import { normalAddress } from "../compliance/recipients";

export type AddressProblem = "bounce" | "complaint" | "provider";

const NOTES: Record<AddressProblem, string> = {
  bounce: "The address rejected an email.",
  complaint: "The person marked an email as spam.",
  provider: "The email service won't deliver to this address because of an earlier bounce or spam report.",
};

export async function suppressAfterProblem(ctx: MutationCtx, message: Doc<"messages">, problem: AddressProblem, at: number): Promise<void> {
  if ((message.channel ?? "sms") !== "email" || !message.to) return;
  const address = normalAddress("email", message.to);
  if (!address) return;
  if (message.purpose === "member_notice") {
    const active = (
      await ctx.db
        .query("noticeSuppressions")
        .withIndex("by_address", (q) => q.eq("address", address))
        .take(20)
    ).find((row) => row.clearedAt === undefined && row.reason === problem);
    if (!active) await ctx.db.insert("noticeSuppressions", { address, reason: problem, at, messageId: message._id });
    return;
  }
  // The company's own list has no "provider" reason: the service's own block is a bounce for this purpose.
  await addSuppression(ctx, { companyId: message.companyId, channel: "email", address, scope: "all", reason: problem === "complaint" ? "complaint" : "bounce", note: NOTES[problem], sourceMessage: message._id, at, actor: { kind: "system" } });
}
