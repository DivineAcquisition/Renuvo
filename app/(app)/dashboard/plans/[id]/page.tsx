import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getPlanDetail } from "@/lib/plans/detail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { RiskBadge } from "@/components/ui/risk-badge";
import { fromCents } from "@/lib/money";
import { PlanActions } from "./PlanActions";

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export default async function PlanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveOrg();
  if (!active) return null;
  const { plan, jobs, payments } = await getPlanDetail(active.org.id, id);
  if (!plan) notFound();

  const customer = plan.customers as unknown as {
    id: string;
    full_name: string | null;
  } | null;
  const cadence = plan.cadence_profiles as unknown as {
    label: string;
  } | null;
  const isOwner = active.role === "owner";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link
                href={`/dashboard/customers/${customer?.id}`}
                className="font-display text-xl font-bold hover:underline"
              >
                {customer?.full_name ?? "Customer"}
              </Link>
              <p className="mt-1 text-sm text-muted-foreground">
                {cadence?.label ?? "—"} ·{" "}
                <Money value={fromCents(plan.price_cents)} />/visit · next{" "}
                {date(plan.next_service_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold capitalize">
                {plan.status}
              </span>
              {plan.risk_level && plan.risk_level !== "none" && (
                <RiskBadge level={plan.risk_level} />
              )}
            </div>
          </div>
          {isOwner && (
            <div className="mt-4">
              <PlanActions planId={plan.id} status={plan.status} />
              <p className="mt-2 text-xs text-muted-foreground">
                Pause and cancel affect future billing only, not past charges.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* billing history */}
      <Card>
        <CardHeader>
          <CardTitle>Billing history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This is the client&apos;s revenue on the provider&apos;s connected
            account.
          </p>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No charges yet.</p>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b py-2 text-sm last:border-0"
              >
                <span className="text-muted-foreground">
                  {date(p.occurred_at)} · {p.category}
                </span>
                <Money value={Number(p.amount_microdollars)} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Visits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No visits scheduled yet.
            </p>
          ) : (
            jobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center justify-between border-b py-2 text-sm last:border-0"
              >
                <span>
                  {date(j.scheduled_at)}{" "}
                  <span className="text-xs text-muted-foreground capitalize">
                    · {j.status}
                  </span>
                </span>
                {j.price_cents != null && (
                  <Money value={fromCents(j.price_cents)} />
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
