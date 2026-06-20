import { createAdminClient } from "@/lib/supabase/admin";
import { onPaymentRecorded } from "@/lib/agent/hooks"; // real in Prompt 15
import { recordConsent } from "@/lib/consent";
import { log } from "@/lib/log";

export type RecordPaymentInput = {
  orgId: string;
  source: string; // 'stripe' | 'manual' | 'square' | ...
  externalId: string; // source's unique payment id (idempotency key)
  amountCents: number;
  currency?: string;
  paidAt?: string; // ISO; defaults now
  customer: {
    phone?: string | null; // E.164; required to create a messageable customer
    email?: string | null;
    fullName?: string | null;
    smsConsent?: boolean; // only true if the SOURCE captured real consent
    consentSource?: string; // e.g. 'booking_form'
  };
  metadata?: Record<string, unknown>;
};

export async function recordPayment(input: RecordPaymentInput) {
  const admin = createAdminClient();
  const currency = input.currency ?? "usd";
  const paidAt = input.paidAt ?? new Date().toISOString();

  // 1) IDEMPOTENCY — already processed this payment?
  const { data: existingJob } = await admin
    .from("jobs")
    .select("id, customer_id")
    .eq("organization_id", input.orgId)
    .eq("payment_source", input.source)
    .eq("payment_external_id", input.externalId)
    .maybeSingle();
  if (existingJob) {
    log.info("payment.recorded", {
      orgId: input.orgId,
      source: input.source,
      isNew: false,
    });
    return {
      isNew: false,
      jobId: existingJob.id,
      customerId: existingJob.customer_id,
    };
  }

  // 2) UPSERT CUSTOMER (thin contact). Needs a valid E.164 phone to be messageable.
  let customerId: string | null = null;
  const phone = input.customer.phone?.trim();
  if (phone && /^\+[1-9]\d{1,14}$/.test(phone)) {
    const { data: existing } = await admin
      .from("customers")
      .select("id")
      .eq("organization_id", input.orgId)
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      customerId = existing.id;
      // upgrade consent only if the source legitimately captured it
      if (input.customer.smsConsent && input.customer.consentSource) {
        await admin
          .from("customers")
          .update({
            sms_consent: true,
            sms_consent_at: new Date().toISOString(),
            sms_consent_source: input.customer.consentSource,
          })
          .eq("id", existing.id)
          .eq("sms_consent", false); // don't overwrite an existing consent record
      }
    } else {
      const { data: created } = await admin
        .from("customers")
        .insert({
          organization_id: input.orgId,
          phone,
          email: input.customer.email ?? null,
          full_name: input.customer.fullName ?? null,
          source: input.source,
          sms_consent: !!(
            input.customer.smsConsent && input.customer.consentSource
          ),
          sms_consent_at: input.customer.smsConsent
            ? new Date().toISOString()
            : null,
          sms_consent_source: input.customer.smsConsent
            ? input.customer.consentSource ?? null
            : null,
        })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
  }

  // 3) CREATE THE ONE-TIME JOB
  const { data: job } = await admin
    .from("jobs")
    .insert({
      organization_id: input.orgId,
      customer_id: customerId, // may be null if no phone yet
      kind: "one_time",
      status: "completed",
      price_cents: input.amountCents,
      currency,
      paid_at: paidAt,
      payment_source: input.source,
      payment_external_id: input.externalId,
      stripe_payment_intent_id:
        input.source === "stripe" ? input.externalId : null,
    })
    .select("id")
    .single();

  // 4) WRITE THE EVENT (idempotent on source+external_id)
  await admin.rpc("record_event", {
    p_org_id: input.orgId,
    p_type: "payment_succeeded",
    p_source: input.source === "stripe" ? "stripe" : "system",
    p_customer_id: customerId ?? undefined,
    p_job_id: job?.id ?? undefined,
    p_external_id: `pay_${input.source}_${input.externalId}`,
    p_payload: {
      amount_cents: input.amountCents,
      currency,
      source: input.source,
      ...input.metadata,
    },
  });

  // record A2P consent proof when the source legitimately captured it
  if (phone && input.customer.smsConsent && input.customer.consentSource) {
    await recordConsent({
      orgId: input.orgId,
      phone,
      source: input.customer.consentSource,
    });
  }

  // 5) HAND OFF TO THE CONVERSION ENGINE (stub now; real in Prompt 15)
  if (job?.id && customerId) {
    await onPaymentRecorded({
      orgId: input.orgId,
      customerId,
      jobId: job.id,
    });
  }

  log.info("payment.recorded", {
    orgId: input.orgId,
    source: input.source,
    isNew: true,
  });
  return { isNew: true, jobId: job?.id ?? null, customerId };
}
