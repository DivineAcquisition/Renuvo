import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getBenchmarks, getWinningMessages, type Benchmark } from "@/lib/intelligence/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageBody } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";

function pct(n: number | null) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function BenchCard({
  title,
  b,
  goodIsHigh,
  framing,
}: {
  title: string;
  b: Benchmark;
  goodIsHigh: boolean;
  framing: string;
}) {
  const delta =
    b.self != null && b.cohort != null ? b.self - b.cohort : null;
  const ahead =
    delta == null ? null : goodIsHigh ? delta >= 0 : delta <= 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-3xl font-bold">{pct(b.self)}</p>
        {b.suppressed ? (
          <p className="mt-1 text-xs text-muted-foreground">
            We need a few more businesses like yours to show a benchmark.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {framing}{" "}
            <span className="font-semibold text-foreground">{pct(b.cohort)}</span>
            {ahead != null && (
              <span
                className={ahead ? "text-emerald-600" : "text-amber-600"}
              >
                {" "}
                · you&apos;re {ahead ? "ahead" : "behind"}
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function IntelligencePage() {
  const active = await getActiveOrg();
  if (!active) return null;

  const [bench, winners] = await Promise.all([
    getBenchmarks(active.org.id),
    getWinningMessages(active.org.id),
  ]);

  return (
    <PageBody>
      <PageHeader
        title="Intelligence"
        description="How you stack up against businesses like yours — anonymized, never identifying any other business."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <BenchCard
          title="Recurring conversion"
          b={bench.conversion}
          goodIsHigh
          framing="vs businesses like you:"
        />
        <BenchCard
          title="Churn rate"
          b={bench.churn}
          goodIsHigh={false}
          framing="vs businesses like you:"
        />
        <BenchCard
          title="Reply rate"
          b={bench.replyRate}
          goodIsHigh
          framing="vs businesses like you:"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What&apos;s converting across the network</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Aggregated across businesses in your category (shown only at meaningful
            volume; no business is ever identified).
          </p>
          {winners.length === 0 ? (
            <EmptyState
              title="Not enough network data yet"
              body="This gets smarter as more businesses like yours come online — we only show patterns at meaningful volume."
            />
          ) : (
            <div className="space-y-2">
              {winners.map((w) => (
                <div
                  key={w.template}
                  className="flex items-center justify-between border-b py-2 text-sm last:border-0"
                >
                  <span className="font-medium">{w.template}</span>
                  <span className="text-muted-foreground">
                    {w.conversion}% converting ·{" "}
                    <span className="font-mono">{w.volume}</span> sends
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}
