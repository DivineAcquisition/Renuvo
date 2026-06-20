import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWinbackMetrics } from "@/lib/winback/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { fromCents } from "@/lib/money";

const KIND_LABEL: Record<string, string> = {
  voluntary: "Win-back",
  involuntary: "Payment recovery",
  lapse: "Reactivation",
};
const STATUS_LABEL: Record<string, string> = {
  eligible: "Eligible",
  in_progress: "In progress",
  recovered: "Recovered",
  exhausted: "Exhausted",
  suppressed: "Suppressed",
};
const STATUS_CLASS: Record<string, string> = {
  recovered: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-primary/10 text-primary",
  eligible: "bg-secondary text-muted-foreground",
  exhausted: "bg-secondary text-muted-foreground",
  suppressed: "bg-destructive/10 text-destructive",
};

export default async function WinbackPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  const enabled = process.env.WINBACK_ENABLED === "true";

  const admin = createAdminClient();
  const [metrics, { data: rows }] = await Promise.all([
    getWinbackMetrics(active.org.id),
    admin
      .from("winback_campaigns")
      .select("id, kind, status, attempt_count, eligible_at, customers(full_name)")
      .eq("organization_id", active.org.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const campaigns = (rows ?? []) as unknown as {
    id: string;
    kind: string;
    status: string;
    attempt_count: number;
    eligible_at: string;
    customers: { full_name: string | null } | null;
  }[];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Win-back &amp; reactivation
        </h1>
        <p className="text-sm text-muted-foreground">
          Bringing customers back — the other half of retention.
        </p>
      </div>

      {!enabled && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Win-back is turned off for this environment. Enable it in Settings →
          Controls to start recovering churned customers.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recovered this month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{metrics.recoveredThisMonth}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recovered plan value</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              <Money value={fromCents(metrics.recoveredPlanValueCents)} />
            </p>
            <p className="text-xs text-muted-foreground">active recovered plans</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Win-back rate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(["voluntary", "involuntary", "lapse"] as const).map((k) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{KIND_LABEL[k]}</span>
                <span className="font-semibold">
                  {metrics.byKind[k].ratePct}%{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({metrics.byKind[k].recovered}/{metrics.byKind[k].attempted})
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No win-back campaigns yet.
            </p>
          ) : (
            <div className="divide-y">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {c.customers?.full_name ?? "Customer"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABEL[c.kind] ?? c.kind} · attempt {c.attempt_count}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      STATUS_CLASS[c.status] ?? "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
