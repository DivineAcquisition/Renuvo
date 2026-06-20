import { describe, it, expect, beforeAll, vi } from "vitest";

// ---- mock external services (deterministic, no real calls) ----
// NOTE: our clients are lazily resolved (getAnthropicClient/getStripe are async,
// the key lives in env or Supabase Vault), so we mock the resolver functions.
vi.mock("@/lib/telnyx/send", () => ({
  sendSmsRaw: vi.fn(async () => ({
    id: `tlx_${Math.random().toString(36).slice(2)}`,
    segments: 1,
  })),
}));
vi.mock("@/lib/anthropic/client", () => ({
  getAnthropicClient: vi.fn(async () => ({
    messages: {
      create: vi.fn(async () => ({
        content: [
          { type: "text", text: "Want recurring service? r.renuvo.io/x" },
        ],
      })),
    },
  })),
  SMS_MODEL: "test",
}));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(async () => ({
    products: { create: vi.fn(async () => ({ id: "prod_test" })) },
    subscriptions: {
      create: vi.fn(async () => ({ id: "sub_test", status: "active" })),
    },
    customers: { update: vi.fn(async () => ({})) },
  })),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { recordPayment } from "@/lib/payments/record";
import { runScheduler } from "@/lib/agent/scheduler";

const admin = createAdminClient();
let orgId: string, customerId: string;

beforeAll(async () => {
  // resolve the Novara seed org + a sendable customer (seed must be loaded)
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "novara")
    .single();
  orgId = org!.id;

  const phone = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
  const { data: cust } = await admin
    .from("customers")
    .insert({
      organization_id: orgId,
      phone,
      full_name: "Test Client",
      sms_consent: true,
      sms_consent_at: new Date().toISOString(),
      sms_consent_source: "test",
    })
    .select("id")
    .single();
  customerId = cust!.id;

  // org needs a number for sends
  await admin
    .from("organizations")
    .update({
      telnyx_phone_number: "+15550000000",
      a2p_status: "approved",
    })
    .eq("id", orgId);

  // fund the wallet
  await admin.rpc("credit_wallet", {
    p_org_id: orgId,
    p_amount_cents: 1000,
    p_type: "credit_manual",
    p_reference: "test",
  });
});

describe("conversion flow", () => {
  it("payment → schedules the sequence", async () => {
    const phone = (
      await admin.from("customers").select("phone").eq("id", customerId).single()
    ).data!.phone;
    const res = await recordPayment({
      orgId,
      source: "manual",
      externalId: `test_${Date.now()}`,
      amountCents: 18000,
      customer: { phone, smsConsent: true, consentSource: "test" },
    });
    expect(res.isNew).toBe(true);

    const { data: sched } = await admin
      .from("scheduled_messages")
      .select("event_key, status")
      .eq("customer_id", customerId);
    expect(sched!.length).toBeGreaterThanOrEqual(1);
    expect(sched!.every((s) => s.status === "pending")).toBe(true);
  });

  it("scheduler sends the due activation", async () => {
    const summary = await runScheduler();
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const { data: sentEvent } = await admin
      .from("events")
      .select("type")
      .eq("customer_id", customerId)
      .eq("type", "activation_sent")
      .maybeSingle();
    expect(sentEvent).toBeTruthy();

    const { data: w } = await admin
      .from("wallets")
      .select("balance_cents")
      .eq("organization_id", orgId)
      .single();
    expect(w!.balance_cents).toBeLessThan(1000);
  });

  it("idempotent: re-recording the same payment adds no sequence", async () => {
    const ext = `dup_${Date.now()}`;
    const phone = (
      await admin.from("customers").select("phone").eq("id", customerId).single()
    ).data!.phone;
    await recordPayment({
      orgId,
      source: "manual",
      externalId: ext,
      amountCents: 18000,
      customer: { phone },
    });
    const before =
      (
        await admin
          .from("scheduled_messages")
          .select("id", { count: "exact", head: true })
      ).count ?? 0;
    await recordPayment({
      orgId,
      source: "manual",
      externalId: ext,
      amountCents: 18000,
      customer: { phone },
    });
    const after =
      (
        await admin
          .from("scheduled_messages")
          .select("id", { count: "exact", head: true })
      ).count ?? 0;
    expect(after).toBe(before);
  });
});
