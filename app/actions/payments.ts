"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { recordPayment } from "@/lib/payments/record";
import { revalidatePath } from "next/cache";

export async function markPaidManually(input: {
  phone: string;
  fullName?: string;
  email?: string;
  amountCents: number;
  smsConsent: boolean;
}) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };

  const res = await recordPayment({
    orgId: active.org.id,
    source: "manual",
    externalId: `manual_${crypto.randomUUID()}`,
    amountCents: input.amountCents,
    customer: {
      phone: input.phone,
      email: input.email,
      fullName: input.fullName,
      // manual entry: the owner attests consent via the checkbox in the UI
      smsConsent: input.smsConsent,
      consentSource: input.smsConsent ? "manual" : undefined,
    },
  });
  revalidatePath("/dashboard");
  return { ok: true, ...res };
}
