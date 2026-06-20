import {
  getConversionByVertical,
  getTtrByVertical,
  getIntentMix,
  getCancellationReasons,
  getRetentionEffectiveness,
} from "@/lib/admin/benchmarks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Benchmarks() {
  const [conv, ttr, intents, cancels, retention] = await Promise.all([
    getConversionByVertical(),
    getTtrByVertical(),
    getIntentMix(),
    getCancellationReasons(),
    getRetentionEffectiveness(),
  ]);

  const empty = "Not enough data yet (needs ≥ 5 orgs in a cohort).";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Conversion rate by vertical (median)</CardTitle>
        </CardHeader>
        <CardContent>
          {conv.length === 0 ? (
            <p className="text-sm text-muted-foreground">{empty}</p>
          ) : (
            conv.map((r) => (
              <div
                key={r.vertical}
                className="flex justify-between border-b py-2 text-sm"
              >
                <span className="capitalize">{r.vertical}</span>
                <span className="font-mono font-semibold">
                  {r.median_conversion_pct}%{" "}
                  <span className="text-xs text-muted-foreground">
                    · n={r.org_count}
                  </span>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Median time-to-rebook (days)</CardTitle>
        </CardHeader>
        <CardContent>
          {ttr.length === 0 ? (
            <p className="text-sm text-muted-foreground">{empty}</p>
          ) : (
            ttr.map((r) => (
              <div
                key={r.vertical}
                className="flex justify-between border-b py-2 text-sm"
              >
                <span className="capitalize">{r.vertical}</span>
                <span className="font-mono font-semibold">
                  {r.median_ttr_days}d{" "}
                  <span className="text-xs text-muted-foreground">
                    · n={r.org_count}
                  </span>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reply intent mix</CardTitle>
        </CardHeader>
        <CardContent>
          {intents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{empty}</p>
          ) : (
            intents.map((r) => (
              <div
                key={r.intent}
                className="flex justify-between border-b py-2 text-sm"
              >
                <span className="capitalize">{r.intent}</span>
                <span className="font-mono">{r.occurrences}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention effectiveness</CardTitle>
        </CardHeader>
        <CardContent>
          {retention.length === 0 ? (
            <p className="text-sm text-muted-foreground">{empty}</p>
          ) : (
            retention.map((r) => (
              <div
                key={r.metric}
                className="flex justify-between border-b py-2 text-sm"
              >
                <span className="capitalize">{r.metric.replace("_", " ")}</span>
                <span className="font-mono font-semibold">
                  {r.rate_pct}%{" "}
                  <span className="text-xs text-muted-foreground">
                    ({r.numerator}/{r.denominator})
                  </span>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Top cancellation reasons</CardTitle>
        </CardHeader>
        <CardContent>
          {cancels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{empty}</p>
          ) : (
            cancels.map((r) => (
              <div
                key={r.reason}
                className="flex justify-between border-b py-2 text-sm"
              >
                <span>{r.reason}</span>
                <span className="font-mono">{r.occurrences}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
