import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  getMetrics,
  getMonthlyConversions,
  getAtRiskPlans,
} from "@/lib/dashboard/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConversionChart } from "./ConversionChart";

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-tight">
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default async function Dashboard() {
  const active = await getActiveOrg();
  if (!active) return null;
  const [m, trend, atRisk] = await Promise.all([
    getMetrics(active.org.id),
    getMonthlyConversions(active.org.id),
    getAtRiskPlans(active.org.id),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Recurring revenue, recovered.
        </p>
      </div>

      {/* headline metrics — mono numerals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Recurring revenue (MRR)"
          value={money(m.mrr_cents)}
          sub={`${money(m.arr_cents)} / yr`}
        />
        <Metric
          label="Active recurring clients"
          value={String(m.active_plans)}
          sub={`${m.at_risk} at risk`}
        />
        <Metric
          label="Conversion rate"
          value={`${m.conversion_rate}%`}
          sub="one-time → recurring"
        />
        <Metric
          label="Median time to rebook"
          value={`${m.median_ttr_days}d`}
        />
        <Metric label="Reply rate" value={`${m.reply_rate}%`} />
        <Metric label="Churn rate" value={`${m.churn_rate}%`} />
        <Metric label="One-time jobs" value={String(m.one_time_jobs)} />
        <Metric label="Total conversions" value={String(m.plans_total)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Conversions, last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionChart data={trend} />
          </CardContent>
        </Card>

        {/* at-risk queue */}
        <Card>
          <CardHeader>
            <CardTitle>At-risk clients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {atRisk.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No at-risk recurring clients.
              </p>
            )}
            {atRisk.map((p) => {
              const customer = p.customers as unknown as {
                id: string;
                full_name: string | null;
                phone: string;
              } | null;
              return (
                <Link
                  key={p.id}
                  href={`/dashboard/customers/${customer?.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 hover:border-primary/40"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {customer?.full_name ?? "Customer"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {money(p.price_cents, p.currency)} / visit
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      p.risk_level === "high"
                        ? "text-destructive"
                        : "text-amber-600"
                    }`}
                  >
                    {p.risk_level} risk
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
