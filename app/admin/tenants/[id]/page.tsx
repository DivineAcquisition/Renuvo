import { notFound } from "next/navigation";
import { getTenantDetail } from "@/lib/admin/queries";
import { Money } from "@/components/ui/money";
import { fromCents } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminTenantActions } from "./AdminTenantActions";

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export default async function AdminTenantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTenantDetail(id);
  if (!t) notFound();

  const card = "border-white/10 bg-white/5 text-white";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {t.name}
          {t.messaging_suspended && (
            <span className="ml-3 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
              suspended
            </span>
          )}
        </h1>
        <p className="text-sm text-white/50">
          Created {date(t.created_at)}
          {t.ownerEmail ? ` · ${t.ownerEmail}` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className={card}>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="capitalize">{t.subscription_status}</p>
            <p className="text-white/50">
              Renews {date(t.current_period_end)}
            </p>
          </CardContent>
        </Card>

        <Card className={card}>
          <CardHeader>
            <CardTitle>A2P</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="capitalize">{t.a2p_status}</p>
            <p className="text-white/50">
              {t.a2p?.step ?? "—"} · score {t.a2p?.vetting_score ?? "—"}
            </p>
          </CardContent>
        </Card>

        <Card className={card}>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              <Money value={fromCents(t.wallet?.balance_cents ?? 0)} />
            </p>
            <p className="text-white/50">
              Auto-reload {t.wallet?.auto_reload_enabled ? "on" : "off"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className={card}>
          <CardHeader>
            <CardTitle>Active plans</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-bold">{t.activePlans}</p>
            <p className="text-xs text-white/50">
              Counts only — no customer data is shown to platform admins.
            </p>
          </CardContent>
        </Card>

        <Card className={card}>
          <CardHeader>
            <CardTitle>What Renuvo earns from this tenant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">SMS margin</span>
              <Money value={t.economics.smsMarginMicro} />
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Subscription fees</span>
              <Money value={t.economics.subscriptionFeesMicro} />
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">SaaS fees</span>
              <Money value={t.economics.saasFeesMicro} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={card}>
        <CardHeader>
          <CardTitle>Compliance kill-switch</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-white/60">
            Suspending immediately stops all of this tenant&apos;s outbound
            messaging and cancels their pending sends. Renuvo carries carrier
            liability — use this fast on violations.
          </p>
          <AdminTenantActions orgId={t.id} suspended={t.messaging_suspended} />
        </CardContent>
      </Card>
    </div>
  );
}
