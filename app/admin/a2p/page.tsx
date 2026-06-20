import Link from "next/link";
import { getA2pOversight } from "@/lib/admin/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminA2p() {
  const { approved, pending, failed, attention } = await getA2pOversight();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        A2P compliance
      </h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
          <p className="font-mono text-2xl font-bold text-emerald-400">
            {approved}
          </p>
          <p className="text-xs text-white/50">Approved</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
          <p className="font-mono text-2xl font-bold text-amber-400">{pending}</p>
          <p className="text-xs text-white/50">Pending</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
          <p className="font-mono text-2xl font-bold text-red-400">{failed}</p>
          <p className="text-xs text-white/50">Failed</p>
        </div>
      </div>

      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {attention.length === 0 && (
            <p className="text-sm text-white/50">
              No stuck, failed, or low-score registrations.
            </p>
          )}
          {attention.map((r) => (
            <Link
              key={r.orgId}
              href={`/admin/tenants/${r.orgId}`}
              className="flex items-center justify-between rounded-lg border border-white/10 p-3 text-sm hover:bg-white/5"
            >
              <div>
                <p className="font-medium">{r.orgName}</p>
                <p className="text-xs text-white/50 capitalize">
                  {r.step ?? "—"} · brand {r.brandStatus ?? "—"} · campaign{" "}
                  {r.campaignStatus ?? "—"}
                </p>
              </div>
              <div className="text-right text-xs text-white/50">
                <p>score {r.vettingScore ?? "—"}</p>
                <p>{r.daysInState}d in state</p>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
