import { telnyxFetch } from "./client";
import { withRetry } from "@/lib/retry";

export type RawSendResult = { id: string; segments: number };

/** Low-level send. Does NO consent/funds checks — use sendGuardedSms below. */
export async function sendSmsRaw(
  from: string,
  to: string,
  text: string,
  messagingProfileId?: string
): Promise<RawSendResult> {
  const body: Record<string, unknown> = { from, to, text };
  if (messagingProfileId) body.messaging_profile_id = messagingProfileId;

  const json = await withRetry(
    () =>
      telnyxFetch("/messages", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    { label: "telnyx.send" }
  );
  const id = json?.data?.id as string;
  const segments = Array.isArray(json?.data?.parts)
    ? json.data.parts.length
    : (json?.data?.parts ?? 1);
  return { id, segments };
}
