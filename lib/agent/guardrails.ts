/**
 * Send-time policy check. Prompt 22 implements quiet-hours (org timezone),
 * per-customer rate limits, and an opt-out re-check. For now, always allow.
 * If not allowed, the scheduler defers the message rather than dropping it.
 */
export async function canSendNow(
  _orgId: string,
  _customerId: string
): Promise<{
  allowed: boolean;
  deferMinutes?: number;
}> {
  return { allowed: true };
}
