import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getLatestBookMetrics } from "@/lib/finintel/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

function pct(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export default async function FinancesPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  if (active.role !== "owner")
    return (
      <p className="text-sm text-muted-foreground">
        Only an owner can view the recurring book.
      </p>
    );

  const m = await getLatestBookMetrics(active.org.id);

  if (!m) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Your recurring revenue
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;re measuring your recurring book — check back after tonight&apos;s
          update once you have active plans.
        </p>
      </div>
    );
  }

  const growthUp = (m.mrr_growth_30d ?? 0) >= 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Your recurring revenue
        </h1>
        <p className="text-sm text-muted-foreground">
          Your recurring book is a real, measurable asset. Here&apos;s its value,
          predictability, and trajectory.
        </p>
      </div>

      {/* Hero: book value */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Recurring book value (monthly)
          </p>
          <p className="mt-1 font-mono text-4xl font-bold">
            <Money value={m.mrr_microdollars} cents={false} />
          </p>
          <p className="mt-1 text-sm">
            <span className={growthUp ? "text-emerald-600" : "text-amber-600"}>
              {growthUp ? "▲" : "▼"} {pct(Math.abs(m.mrr_growth_30d ?? 0))}
            </span>{" "}
            <span className="text-muted-foreground">
              vs 30 days ago · {m.active_plans} active plans ·{" "}
              <Money value={m.avg_plan_value_microdollars} cents={false} /> avg
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Predictability */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Predictability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Collection rate" value={pct(m.collection_rate)} />
            <Row label="Churn (30d)" value={pct(m.churn_rate_30d)} />
            <Row
              label="Involuntary churn"
              value={pct(m.involuntary_churn_rate_30d)}
            />
            <Row
              label="Forward revenue (next 3 mo)"
              value={
                <Money
                  value={m.churn_adjusted_forward_mrr ?? 0}
                  cents={false}
                />
              }
            />
          </CardContent>
        </Card>

        {/* Trajectory */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trajectory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="MRR growth (30d)" value={pct(m.mrr_growth_30d)} />
            <Row label="Net revenue retention" value={pct(m.net_revenue_retention)} />
            <Row label="Book age" value={`${m.book_age_days ?? 0} days`} />
          </CardContent>
        </Card>
      </div>

      {/* Book health */}
      <Card>
        <CardHeader>
          <CardTitle>Book health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-4xl font-bold">
              {m.book_health_score ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
          {m.health_reason && (
            <p className="mt-2 text-sm text-muted-foreground">{m.health_reason}</p>
          )}
          {(m.involuntary_churn_rate_30d ?? 0) > 0 && (
            <p className="mt-3 text-sm">
              Improve it:{" "}
              <Link
                href="/dashboard/accounts"
                className="font-medium text-primary underline"
              >
                request card updates
              </Link>{" "}
              for failing payments, and{" "}
              <Link
                href="/dashboard/winback"
                className="font-medium text-primary underline"
              >
                win back recent cancellations
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
