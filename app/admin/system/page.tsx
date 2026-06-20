import { createAdminClient } from "@/lib/supabase/admin";
import { getServerSecret } from "@/lib/secrets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FRESH_MINUTES: Record<string, number> = {
  scheduler: 15,
  process_deletions: 60 * 26,
  retention: 60 * 24 * 8,
};

function freshness(jobName: string, lastRunAt: string | null) {
  if (!lastRunAt) return { label: "never run", tone: "text-red-400" };
  const mins = (Date.now() - new Date(lastRunAt).getTime()) / 60000;
  const limit = FRESH_MINUTES[jobName] ?? 60;
  if (mins <= limit) return { label: "healthy", tone: "text-emerald-400" };
  if (mins <= limit * 2) return { label: "stale", tone: "text-amber-400" };
  return { label: "down", tone: "text-red-400" };
}

export default async function AdminSystem() {
  const admin = createAdminClient();
  const [{ data: beats }, dbOk] = await Promise.all([
    admin
      .from("system_heartbeats")
      .select("job_name, last_run_at, last_status"),
    admin
      .from("verticals")
      .select("id")
      .limit(1)
      .then((r) => !r.error),
  ]);

  const deps = {
    db: dbOk,
    stripe: !!(await getServerSecret("STRIPE_SECRET_KEY")),
    telnyx: !!(await getServerSecret("TELNYX_API_KEY")),
  };

  const jobs = ["scheduler", "process_deletions", "retention"];
  const beatMap = new Map(
    (beats ?? []).map((b) => [b.job_name as string, b])
  );

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        System status
      </h1>

      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle>Cron heartbeats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.map((job) => {
            const b = beatMap.get(job) as
              | { last_run_at: string; last_status: string | null }
              | undefined;
            const f = freshness(job, b?.last_run_at ?? null);
            return (
              <div
                key={job}
                className="flex items-center justify-between border-b border-white/5 py-2 text-sm last:border-0"
              >
                <span className="font-mono">{job}</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-white/50">
                    {b?.last_run_at
                      ? new Date(b.last_run_at).toLocaleString()
                      : "—"}
                  </span>
                  <span className={`text-xs font-semibold ${f.tone}`}>
                    {f.label}
                  </span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle>Dependencies</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-center">
          {Object.entries(deps).map(([k, v]) => (
            <div key={k}>
              <p
                className={`font-mono text-lg font-bold ${
                  v ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {v ? "OK" : "DOWN"}
              </p>
              <p className="text-xs uppercase text-white/50">{k}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
