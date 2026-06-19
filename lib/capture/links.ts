import { buildCaptureUrl } from "@/lib/urls";

/**
 * Returns the recurring-signup link an SMS points to. Prompt 18 replaces this
 * with a DB-backed, signed, single-use token. For now returns a placeholder so
 * generation works end-to-end.
 */
export async function getSignupLink(_args: {
  orgId: string;
  customerId: string;
  jobId?: string;
}): Promise<string> {
  return buildCaptureUrl("pending"); // TODO Prompt 18: mint a real token
}
