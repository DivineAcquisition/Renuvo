"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  AlertTriangle,
  MessageSquareText,
  CreditCard,
  BarChart3,
  Wallet,
  Upload,
  Settings,
  CheckCircle2,
  Circle,
  Activity,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Money } from "@/components/ui/money";
import { CountUp } from "@/components/ui/count-up";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import type { HomeSummary } from "@/lib/home/queries";
import type { AttentionItems, ActivityEvent } from "@/lib/home/feed";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function name(c: { full_name: string | null } | null) {
  return c?.full_name ?? "Customer";
}

const ACTIVITY_COPY: Record<string, string> = {
  plan_created: "A plan was created",
  activated: "A client started recurring service",
  paused: "A plan was paused",
  resumed: "A plan resumed",
  churn_risk_flagged: "A plan was flagged at risk",
  save_offer_sent: "A save offer was sent",
  save_offer_accepted: "A save offer was accepted",
  save_offer_declined: "A save offer was declined",
  cancelled: "A plan was cancelled",
  winback_sent: "A win-back was sent",
  winback_recovered: "A lapsed client came back",
  payment_failed: "A payment failed",
  payment_recovered: "A payment recovered",
};

function relativeTime(iso: string, nowMs: number) {
  const diff = nowMs - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function SnapStat({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="hover-lift block rounded-2xl border bg-card p-5 shadow-sm"
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{children}</p>
    </Link>
  );
}

export function HomeView({
  orgName,
  userName,
  summary,
  attention,
  activity,
  isOwner,
}: {
  orgName: string;
  userName: string;
  summary: HomeSummary;
  attention: AttentionItems;
  activity: ActivityEvent[];
  isOwner: boolean;
}) {
  // Time-based values are computed after mount to avoid SSR/client hydration
  // mismatches (server runs in UTC; the visitor is in their own timezone).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const s = summary.setup;
  const mode = s.messaging_suspended
    ? "suspended"
    : !s.onboarding_complete
      ? "setup"
      : s.a2p_status !== "approved"
        ? "pending"
        : "live";

  const attentionTotal =
    summary.attention.at_risk_plans +
    summary.attention.replies_need_human +
    summary.attention.failed_payments;

  const checklist = [
    {
      label: "Connect Stripe",
      done: s.stripe_connected,
      href: "/dashboard/settings/payments",
    },
    {
      label: "Choose a plan",
      done: ["active", "trialing"].includes(s.subscription_status),
      href: "/dashboard/settings/payments",
    },
    {
      label: "Get a texting number",
      done: s.has_number,
      href: "/onboarding",
    },
    {
      label: "Register for A2P",
      done: s.a2p_status === "approved",
      href: "/dashboard/settings/messaging/a2p",
    },
    {
      label: "Import customers",
      done: s.has_customers,
      href: "/onboarding",
    },
  ];
  const firstIncomplete = checklist.find((c) => !c.done);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* A) GREETING */}
      <Reveal>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {now ? greeting() : "Welcome"}, {userName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {now
                ? `${now.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })} · ${orgName}`
                : orgName}
            </p>
          </div>
          {mode === "setup" ? (
            <Button asChild variant="gradient">
              <Link href="/onboarding">
                Finish setup <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/dashboard/analytics">
                View analytics <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </Reveal>

      {/* B) STATE BANNER */}
      {mode === "suspended" && (
        <Reveal delay={0.05}>
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="h-5 w-5" /> Messaging paused for review
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your account&apos;s outbound texting is temporarily paused. Reach
              out to support to resolve this.
            </p>
          </div>
        </Reveal>
      )}

      {mode === "setup" && (
        <Reveal delay={0.05}>
          <GlassCard>
            <h2 className="font-display text-lg font-bold">Finish your setup</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              A few steps to get Renuvo working for you.
            </p>
            <div className="space-y-2">
              {checklist.map((c) => {
                const emphasize = c === firstIncomplete;
                return (
                  <Link
                    key={c.label}
                    href={c.href}
                    className={`flex items-center justify-between rounded-xl border p-3 text-sm transition-colors hover:border-primary/40 ${
                      emphasize ? "border-primary/40 bg-primary/5" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {c.done ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={c.done ? "text-muted-foreground" : ""}>
                        {c.label}
                      </span>
                    </span>
                    {emphasize && (
                      <span className="text-xs font-semibold text-primary">
                        Continue →
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </GlassCard>
        </Reveal>
      )}

      {mode === "pending" && (
        <Reveal delay={0.05}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <span>
              Texting is being approved (A2P {s.a2p_status}). You can keep setting
              up — sends start once it&apos;s approved.
            </span>
            <Link
              href="/dashboard/settings/messaging/a2p"
              className="font-semibold underline"
            >
              View A2P status →
            </Link>
          </div>
        </Reveal>
      )}

      {mode === "live" && summary.attention.wallet_low && (
        <Reveal delay={0.05}>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <span>Your SMS balance is low — top up to keep sequences running.</span>
            <Link
              href="/dashboard/settings/payments"
              className="font-semibold underline"
            >
              Add funds →
            </Link>
          </div>
        </Reveal>
      )}

      {/* C) SNAPSHOT */}
      <Reveal delay={0.1}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SnapStat label="Active plans" href="/dashboard/analytics">
            <CountUp value={summary.snapshot.active_plans} format="int" />
          </SnapStat>
          <SnapStat label="Recurring revenue" href="/dashboard/analytics">
            <Money value={summary.snapshot.mrr_microdollars} cents={false} />
          </SnapStat>
          <SnapStat label="Conversions (7d)" href="/dashboard/analytics">
            <CountUp value={summary.snapshot.conversions_7d} format="int" />
          </SnapStat>
          <SnapStat label="Pending messages" href="/dashboard/analytics">
            <CountUp value={summary.snapshot.pending_messages} format="int" />
          </SnapStat>
        </div>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* D) NEEDS YOU */}
        <Reveal delay={0.14} className="lg:col-span-2">
          <GlassCard>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Needs you</h2>
              {attentionTotal > 0 && (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {attentionTotal}
                </span>
              )}
            </div>

            {attentionTotal === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              <div className="space-y-4">
                {attention.failedPayments.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Failed payments
                    </p>
                    {attention.failedPayments.map((p) => (
                      <Link
                        key={p.id}
                        href={`/dashboard/customers/${p.customer_id}`}
                        className="flex items-center justify-between rounded-xl border p-3 text-sm hover:border-primary/40"
                      >
                        <span className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-destructive" />
                          {name(p.customers)}
                        </span>
                        <span className="text-xs font-semibold text-primary">
                          Fix →
                        </span>
                      </Link>
                    ))}
                  </div>
                )}

                {attention.replies.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Replies waiting
                    </p>
                    {attention.replies.map((r) => (
                      <Link
                        key={r.id}
                        href={`/dashboard/customers/${r.id}`}
                        className="flex items-center justify-between rounded-xl border p-3 text-sm hover:border-primary/40"
                      >
                        <span className="flex items-center gap-2">
                          <MessageSquareText className="h-4 w-4 text-primary" />
                          {r.full_name ?? "Customer"}
                        </span>
                        <span className="text-xs font-semibold text-primary">
                          Reply →
                        </span>
                      </Link>
                    ))}
                  </div>
                )}

                {attention.atRisk.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      At-risk plans
                    </p>
                    {attention.atRisk.map((p) => (
                      <Link
                        key={p.id}
                        href={`/dashboard/customers/${p.customer_id}`}
                        className="flex items-center justify-between rounded-xl border p-3 text-sm hover:border-primary/40"
                      >
                        <span>{name(p.customers)}</span>
                        <RiskBadge level={p.risk_level ?? "medium"} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassCard>
        </Reveal>

        {/* F) RECENT ACTIVITY */}
        <Reveal delay={0.18}>
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <h2 className="mb-4 font-display text-lg font-bold">
              Recent activity
            </h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Activity will show up here as your customers move through the
                conversion flow.
              </p>
            ) : (
              <div className="space-y-3">
                {activity.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 text-sm">
                    <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p>{ACTIVITY_COPY[e.type] ?? e.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {now ? relativeTime(e.occurred_at, now.getTime()) : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Reveal>
      </div>

      {/* E) QUICK ACTIONS */}
      <Reveal delay={0.22}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Analytics", href: "/dashboard/analytics", Icon: BarChart3 },
            {
              label: "Import customers",
              href: "/onboarding",
              Icon: Upload,
              owner: true,
            },
            {
              label: "Billing",
              href: "/dashboard/settings/payments",
              Icon: Wallet,
            },
            {
              label: "Messaging",
              href: "/dashboard/settings/messaging",
              Icon: Settings,
            },
          ]
            .filter((a) => !a.owner || isOwner)
            .map(({ label, href, Icon }) => (
              <Link
                key={label}
                href={href}
                className="hover-lift flex items-center gap-3 rounded-xl border bg-card p-4 text-sm font-medium shadow-sm"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </Link>
            ))}
        </div>
      </Reveal>
    </div>
  );
}
