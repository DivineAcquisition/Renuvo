import { getBookPortfolio } from "@/lib/finintel/queries";
import { Money } from "@/components/ui/money";

function pct(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export default async function AdminFinancePage() {
  const rows = await getBookPortfolio();

  const totalMrr = rows.reduce((s, r) => s + Number(r.mrr_microdollars), 0);
  const totalForward = rows.reduce(
    (s, r) => s + Number(r.churn_adjusted_forward_mrr ?? 0),
    0
  );
  // "high-confidence" forward revenue: healthy collection + low churn + some age
  const highConfidence = rows
    .filter(
      (r) =>
        (r.collection_rate ?? 0) >= 0.95 &&
        (r.churn_rate_30d ?? 1) <= 0.05 &&
        (r.book_age_days ?? 0) >= 60
    )
    .reduce((s, r) => s + Number(r.churn_adjusted_forward_mrr ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Book portfolio</h1>
        <p className="text-sm text-white/60">
          Read-only measurement of the marketplace&apos;s recurring books. This is a
          measurement dashboard only — there are no advances, offers, or
          underwriting actions here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Recurring volume under management (monthly)" value={<Money value={totalMrr} cents={false} />} />
        <Stat label="Churn-adjusted forward MRR" value={<Money value={totalForward} cents={false} />} />
        <Stat label="High-confidence forward MRR" value={<Money value={highConfidence} cents={false} />} />
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
            <tr>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">MRR</th>
              <th className="px-3 py-2">Collection</th>
              <th className="px-3 py-2">Churn</th>
              <th className="px-3 py-2">Volatility</th>
              <th className="px-3 py-2">Fwd MRR</th>
              <th className="px-3 py-2">Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-white/40">
                  No book metrics computed yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.organization_id}
                  className="border-t border-white/5 hover:bg-white/5"
                >
                  <td className="px-3 py-2 font-medium">{r.org_name}</td>
                  <td className="px-3 py-2">
                    <Money value={Number(r.mrr_microdollars)} cents={false} />
                  </td>
                  <td className="px-3 py-2">{pct(r.collection_rate)}</td>
                  <td className="px-3 py-2">{pct(r.churn_rate_30d)}</td>
                  <td className="px-3 py-2">
                    <Money value={Number(r.mrr_volatility ?? 0)} cents={false} />
                  </td>
                  <td className="px-3 py-2">
                    <Money
                      value={Number(r.churn_adjusted_forward_mrr ?? 0)}
                      cents={false}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        (r.book_health_score ?? 0) >= 70
                          ? "text-emerald-400"
                          : (r.book_health_score ?? 0) >= 40
                            ? "text-amber-400"
                            : "text-rose-400"
                      }
                    >
                      {r.book_health_score ?? "—"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs text-white/50">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold">{value}</p>
    </div>
  );
}
