import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Takeover } from "./Takeover";

import { fromCents, formatMoney } from "@/lib/money";

function money(c?: number | null) {
  return c == null ? "—" : formatMoney(fromCents(c));
}

export default async function CustomerProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveOrg();
  if (!active) return null;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, phone, sms_sendable, agent_paused")
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .maybeSingle();
  if (!customer) notFound();

  const [{ data: plan }, { data: timeline }] = await Promise.all([
    supabase
      .from("recurring_plans")
      .select(
        "status, risk_level, price_cents, currency, next_service_at, cadence_profiles(label)"
      )
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("events")
      .select("type, direction, body, occurred_at")
      .eq("organization_id", active.org.id)
      .eq("customer_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  const conversation = (timeline ?? [])
    .filter(
      (e) => e.body && (e.direction === "inbound" || e.direction === "outbound")
    )
    .reverse();

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <h1 className="font-display text-2xl font-bold">
            {customer.full_name ?? "Customer"}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {customer.phone}
          </p>
        </div>

        {/* conversation */}
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversation.length === 0 && (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            )}
            {conversation.map((m, i) => (
              <div
                key={i}
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.direction === "outbound"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-secondary"
                }`}
              >
                {m.body}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* human takeover */}
        <Takeover
          customerId={customer.id}
          sendable={!!customer.sms_sendable}
          agentPaused={customer.agent_paused}
        />
      </div>

      {/* plan sidebar */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Recurring plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {plan ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium capitalize">{plan.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cadence</span>
                  <span className="font-medium">
                    {(plan.cadence_profiles as unknown as {
                      label: string;
                    } | null)?.label ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-mono font-medium">
                    {money(plan.price_cents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Risk</span>
                  <span className="font-medium capitalize">
                    {plan.risk_level}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No recurring plan yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
