import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getCustomerDetail } from "@/lib/customers/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { RiskBadge } from "@/components/ui/risk-badge";
import { fromCents } from "@/lib/money";
import { DeleteCustomer } from "./DeleteCustomer";
import { EnrollButton } from "./EnrollButton";
import { RecordPayment } from "./RecordPayment";

const ACTIVITY_COPY: Record<string, string> = {
  plan_created: "Plan created",
  activated: "Started recurring service",
  paused: "Plan paused",
  resumed: "Plan resumed",
  cancelled: "Plan cancelled",
  save_offer_sent: "Save offer sent",
  save_offer_accepted: "Save offer accepted",
  winback_sent: "Win-back sent",
  winback_recovered: "Came back",
  payment_failed: "Payment failed",
  payment_recovered: "Payment recovered",
};

function relTime(iso: string) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

export default async function CustomerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveOrg();
  if (!active) return null;
  const { customer, plans, events } = await getCustomerDetail(active.org.id, id);
  if (!customer) notFound();

  const isOwner = active.role === "owner";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#9A8CFF] to-[#4F38FF] text-sm font-bold text-white">
                {(customer.full_name ?? "C").slice(0, 2).toUpperCase()}
              </span>
              <div>
                <h1 className="font-display text-xl font-bold">
                  {customer.full_name ?? "Customer"}
                </h1>
                <p className="font-mono text-sm text-muted-foreground">
                  {customer.phone}
                </p>
                {customer.email && (
                  <p className="text-xs text-muted-foreground">
                    {customer.email}
                  </p>
                )}
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                customer.sms_sendable
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {customer.sms_sendable ? "Sendable" : "No SMS consent"}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/inbox/${customer.id}`}>Message</Link>
            </Button>
            {isOwner && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/customers/${customer.id}/edit`}>
                  Edit
                </Link>
              </Button>
            )}
            {isOwner && (
              <EnrollButton
                customerId={customer.id}
                sendable={!!customer.sms_sendable}
              />
            )}
            {isOwner && (
              <RecordPayment
                phone={customer.phone}
                fullName={customer.full_name ?? null}
                smsSendable={!!customer.sms_sendable}
              />
            )}
            {isOwner && <DeleteCustomer customerId={customer.id} />}
          </div>
        </CardContent>
      </Card>

      {/* plans */}
      <Card>
        <CardHeader>
          <CardTitle>Recurring plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recurring plan yet.
            </p>
          ) : (
            plans.map((p) => {
              const cadence = p.cadence_profiles as unknown as {
                label: string;
              } | null;
              return (
                <Link
                  key={p.id}
                  href={`/dashboard/plans/${p.id}`}
                  className="flex items-center justify-between rounded-xl border p-3 text-sm hover:border-primary/40"
                >
                  <div>
                    <p className="font-medium capitalize">{p.status}</p>
                    <p className="text-xs text-muted-foreground">
                      {cadence?.label ?? "—"} ·{" "}
                      <Money value={fromCents(p.price_cents)} />/visit
                    </p>
                  </div>
                  {p.risk_level && p.risk_level !== "none" && (
                    <RiskBadge level={p.risk_level} />
                  )}
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* activity */}
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between border-b py-2 text-sm last:border-0"
              >
                <span>{ACTIVITY_COPY[e.type] ?? e.type}</span>
                <span className="text-xs text-muted-foreground">
                  {relTime(e.occurred_at)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
