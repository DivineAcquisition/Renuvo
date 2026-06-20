import { getPlatformRevenue } from "@/lib/money/reports";
import { getRevenueTrend } from "@/lib/admin/queries";
import { Money } from "@/components/ui/money";
import { AreaChart } from "@/components/ui/area-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{children}</p>
    </div>
  );
}

export default async function AdminRevenue() {
  const [rev, trend] = await Promise.all([
    getPlatformRevenue(),
    getRevenueTrend(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Platform revenue
      </h1>
      <p className="-mt-3 text-sm text-white/50">Last 30 days.</p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="SMS margin">
          <Money value={rev?.sms_margin_micro ?? 0} />
        </Stat>
        <Stat label="Subscription fees">
          <Money value={rev?.subscription_fees_micro ?? 0} />
        </Stat>
        <Stat label="SMS cost">
          <Money value={rev?.sms_cost_micro ?? 0} />
        </Stat>
        <Stat label="Net revenue">
          <span className="text-amber-400">
            <Money value={rev?.net_revenue_micro ?? 0} />
          </span>
        </Stat>
      </div>

      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle>Net platform revenue, last 12 weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <AreaChart data={trend} />
        </CardContent>
      </Card>
    </div>
  );
}
