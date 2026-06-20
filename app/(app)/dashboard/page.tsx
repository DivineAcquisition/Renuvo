import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  getMetrics,
  getMonthlyConversions,
  getAtRiskPlans,
} from "@/lib/dashboard/queries";
import { GlassCard } from "@/components/ui/glass-card";
import { StatCard } from "@/components/ui/stat-card";
import { AccentStatCard } from "@/components/ui/accent-stat-card";
import { AreaChart } from "@/components/ui/area-chart";
import { LiveBadge } from "@/components/ui/live-badge";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Reveal } from "@/components/ui/reveal";
import { ConversionWidget } from "@/components/dashboard/ConversionWidget";

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function Dashboard() {
  const active = await getActiveOrg();
  if (!active) return null;
  const [m, trend, atRisk] = await Promise.all([
    getMetrics(active.org.id),
    getMonthlyConversions(active.org.id),
    getAtRiskPlans(active.org.id),
  ]);

  const spark = trend.map((t) => t.conversions);
  const chartData = trend.map((t) => ({ label: t.month, value: t.conversions }));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Recurring revenue, recovered.
          </p>
        </div>
        <LiveBadge />
      </div>

      {/* headline metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <AccentStatCard
            label="Recurring revenue (MRR)"
            value={m.mrr_cents / 100}
            format="money"
            trend="23% vs last month"
            sub={`${money(m.arr_cents)} / yr`}
          />
        </Reveal>
        <Reveal delay={0.06}>
          <StatCard
            label="Active recurring clients"
            value={m.active_plans}
            format="int"
            sub={`${m.at_risk} at risk`}
            sparkline={spark}
          />
        </Reveal>
        <Reveal delay={0.12}>
          <StatCard
            label="Conversion rate"
            value={m.conversion_rate}
            format="pct"
            sub="one-time → recurring"
            sparkline={spark}
          />
        </Reveal>
        <Reveal delay={0.18}>
          <StatCard
            label="Reply rate"
            value={m.reply_rate}
            format="pct"
            sparkline={spark}
          />
        </Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* trend chart */}
        <Reveal delay={0.1} className="lg:col-span-2">
          <div className="hover-lift rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">
                Conversions, last 6 months
              </h2>
            </div>
            <AreaChart data={chartData} />
          </div>
        </Reveal>

        {/* THE signature glass element */}
        <Reveal delay={0.16}>
          <GlassCard badge={`${m.conversion_rate}% converted`}>
            <ConversionWidget />
          </GlassCard>
        </Reveal>
      </div>

      {/* secondary metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatCard label="Churn rate" value={m.churn_rate} format="pct" />
        </Reveal>
        <Reveal delay={0.06}>
          <StatCard
            label="Median time to rebook"
            value={m.median_ttr_days}
            format="int"
            sub="days"
          />
        </Reveal>
        <Reveal delay={0.12}>
          <StatCard label="One-time jobs" value={m.one_time_jobs} format="int" />
        </Reveal>
        <Reveal delay={0.18}>
          <StatCard
            label="Total conversions"
            value={m.plans_total}
            format="int"
          />
        </Reveal>
      </div>

      {/* at-risk queue */}
      <Reveal delay={0.1}>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-lg font-bold">
            At-risk clients
          </h2>
          <div className="space-y-2">
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
              const name = customer?.full_name ?? "Customer";
              const initials = name.slice(0, 2).toUpperCase();
              return (
                <Link
                  key={p.id}
                  href={`/dashboard/customers/${customer?.id}`}
                  className="flex items-center justify-between rounded-xl border p-3 transition-all hover:translate-x-0.5 hover:border-primary/40"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#9A8CFF] to-[#4F38FF] text-xs font-bold text-white">
                      {initials}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {money(p.price_cents, p.currency)} / visit
                      </p>
                    </div>
                  </div>
                  <RiskBadge level={p.risk_level} />
                </Link>
              );
            })}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
