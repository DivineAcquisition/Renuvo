import Link from "next/link";
import { getTenantDirectory, getA2pOversight } from "@/lib/admin/queries";
import { getPlatformRevenue } from "@/lib/money/reports";
import { Money } from "@/components/ui/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{children}</p>
    </div>
  );
}

export default async function AdminOverview() {
  const [tenants, revenue, a2p] = await Promise.all([
    getTenantDirectory(),
    getPlatformRevenue(),
    getA2pOversight(),
  ]);

  const activeTenants = tenants.filter(
    (t) => t.subscription_status === "active" || t.subscription_status === "trialing"
  ).length;
  const totalPlans = tenants.reduce((s, t) => s + (t.active_plans ?? 0), 0);
  const needsAttention = tenants.filter(
    (t) =>
      t.messaging_suspended ||
      t.subscription_status === "past_due" ||
      ["failed", "brand_failed", "campaign_failed"].includes(t.a2p_status)
  );

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Overview</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Net revenue (30d)">
          <Money value={revenue?.net_revenue_micro ?? 0} />
        </Stat>
        <Stat label="Active tenants">{activeTenants}</Stat>
        <Stat label="Active plans (platform)">
          <span className="font-mono">{totalPlans}</span>
        </Stat>
        <Stat label="Needs attention">
          <span className="font-mono">{needsAttention.length}</span>
        </Stat>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-white/10 bg-white/5 text-white">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsAttention.length === 0 && (
              <p className="text-sm text-white/50">All tenants healthy.</p>
            )}
            {needsAttention.map((t) => (
              <Link
                key={t.id}
                href={`/admin/tenants/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-white/10 p-3 text-sm hover:bg-white/5"
              >
                <span>{t.name}</span>
                <span className="text-xs text-amber-400">
                  {t.messaging_suspended
                    ? "suspended"
                    : t.subscription_status === "past_due"
                      ? "past due"
                      : "A2P issue"}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 text-white">
          <CardHeader>
            <CardTitle>A2P health</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="font-mono text-2xl font-bold text-emerald-400">
                {a2p.approved}
              </p>
              <p className="text-xs text-white/50">Approved</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-bold text-amber-400">
                {a2p.pending}
              </p>
              <p className="text-xs text-white/50">Pending</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-bold text-red-400">
                {a2p.failed}
              </p>
              <p className="text-xs text-white/50">Failed</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
