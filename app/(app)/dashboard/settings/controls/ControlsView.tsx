"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  saveAutomation,
  saveOfferConfig,
  saveWinbackConfig,
  saveSequence,
  resetSequence,
  saveNotificationPref,
  type SequenceStepInput,
} from "@/app/actions/controls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TEMPLATES = [
  "post_payment_activation",
  "conversion_offer",
  "reminder",
  "objection_followup",
  "recurring_confirmation",
  "winback",
  "save_offer",
];
const DELAYS = [
  { v: 0, label: "Immediately" },
  { v: 60, label: "1 hour later" },
  { v: 1440, label: "1 day later" },
  { v: 4320, label: "3 days later" },
  { v: 10080, label: "1 week later" },
];
const CADENCES = ["weekly", "biweekly", "monthly"];
const PITCH = ["gentle", "balanced", "direct"] as const;
const EVENT_LABEL: Record<string, string> = {
  new_conversion: "New conversion",
  at_risk: "Plan at risk",
  failed_payment: "Failed payment",
  reply_needs_human: "Reply needs a human",
  approval_pending: "Approval pending",
  wallet_low: "Wallet low",
};

export function ControlsView({
  isOwner,
  agentMode,
  maxFollowUps,
  offer,
  winback,
  steps,
  notifEvents,
  prefMap,
}: {
  isOwner: boolean;
  agentMode: "auto" | "review";
  maxFollowUps: number;
  offer: {
    discountPct: number;
    offeredCadences: string[];
    defaultCadence: string;
    pitchStyle: "gentle" | "balanced" | "direct";
  };
  winback: {
    enabled: boolean;
    discountPct: number;
    cooldownDays: number;
    maxAttempts: number;
    retryGapDays: number;
  };
  steps: { template_key: string; delay_minutes: number; enabled: boolean }[];
  notifEvents: string[];
  prefMap: Record<string, { email: boolean; in_app: boolean }>;
}) {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Controls</h1>
      {isOwner && (
        <>
          <Automation agentMode={agentMode} maxFollowUps={maxFollowUps} />
          <Offer offer={offer} />
          <Winback winback={winback} />
          <Sequence steps={steps} />
        </>
      )}
      <Notifications events={notifEvents} prefMap={prefMap} />
    </div>
  );
}

function Winback({
  winback,
}: {
  winback: {
    enabled: boolean;
    discountPct: number;
    cooldownDays: number;
    maxAttempts: number;
    retryGapDays: number;
  };
}) {
  const [enabled, setEnabled] = useState(winback.enabled);
  const [discount, setDiscount] = useState(winback.discountPct);
  const [cooldown, setCooldown] = useState(winback.cooldownDays);
  const [maxAttempts, setMaxAttempts] = useState(winback.maxAttempts);
  const [gap, setGap] = useState(winback.retryGapDays);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await saveWinbackConfig({
      enabled,
      discountPct: discount,
      cooldownDays: cooldown,
      maxAttempts,
      retryGapDays: gap,
    });
    setBusy(false);
    if ("error" in r) toast.error(r.error ?? "Failed");
    else toast.success("Win-back saved.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Win-back &amp; reactivation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Brings churned customers back. Re-contacting people too aggressively
          breeds spam complaints that hurt your sending reputation — so keep it
          gentle and capped. Failed-payment customers get a card-fix message, not a
          discount.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="font-medium">Enable win-back</span>
        </label>
        <div className="space-y-1.5">
          <Label>Win-back discount: {discount}%</Label>
          <input
            type="range"
            min={0}
            max={90}
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Cooldown (days)</Label>
            <input
              type="number"
              min={0}
              max={180}
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max attempts</Label>
            <input
              type="number"
              min={1}
              max={5}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Retry gap (days)</Label>
            <input
              type="number"
              min={1}
              max={120}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save win-back"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Automation({
  agentMode,
  maxFollowUps,
}: {
  agentMode: "auto" | "review";
  maxFollowUps: number;
}) {
  const [mode, setMode] = useState(agentMode);
  const [max, setMax] = useState(maxFollowUps);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await saveAutomation({ agentMode: mode, maxFollowUps: max });
    setBusy(false);
    toast[("error" in r ? "error" : "success") as "error" | "success"](
      "error" in r ? r.error ?? "Failed" : "Automation saved."
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              checked={mode === "auto"}
              onChange={() => setMode("auto")}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Auto</span> — Renuvo sends messages on
              its own.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              checked={mode === "review"}
              onChange={() => setMode("review")}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Review</span> — Renuvo drafts; you
              approve each message before it sends.
            </span>
          </label>
        </div>
        <div className="space-y-1.5">
          <Label>Max follow-ups per customer</Label>
          <input
            type="number"
            min={0}
            max={10}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="flex h-10 w-24 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save automation"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Offer({
  offer,
}: {
  offer: {
    discountPct: number;
    offeredCadences: string[];
    defaultCadence: string;
    pitchStyle: "gentle" | "balanced" | "direct";
  };
}) {
  const [discount, setDiscount] = useState(offer.discountPct);
  const [cadences, setCadences] = useState<string[]>(offer.offeredCadences);
  const [def, setDef] = useState(offer.defaultCadence);
  const [pitch, setPitch] = useState(offer.pitchStyle);
  const [busy, setBusy] = useState(false);

  function toggleCadence(c: string) {
    setCadences((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }
  async function save() {
    if (!cadences.includes(def)) {
      toast.error("Default cadence must be one of the offered cadences.");
      return;
    }
    setBusy(true);
    const r = await saveOfferConfig({
      recurringDiscountPct: discount,
      offeredCadences: cadences,
      defaultCadence: def,
      pitchStyle: pitch,
    });
    setBusy(false);
    if ("error" in r) toast.error(r.error ?? "Failed");
    else toast.success("Offer saved.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Offer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Recurring discount: {discount}%</Label>
          <input
            type="range"
            min={0}
            max={90}
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Example: a $200 visit shows{" "}
            <span className="font-mono line-through">$200</span>{" "}
            <span className="font-mono font-semibold">
              ${(200 * (1 - discount / 100)).toFixed(0)}
            </span>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Offered cadences</Label>
          <div className="flex gap-2">
            {CADENCES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCadence(c)}
                className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                  cadences.includes(c)
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Default cadence</Label>
          <select
            value={def}
            onChange={(e) => setDef(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {cadences.map((c) => (
              <option key={c} value={c} className="capitalize">
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Pitch style</Label>
          <div className="flex gap-2">
            {PITCH.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPitch(p)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                  pitch === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save offer"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Sequence({
  steps,
}: {
  steps: { template_key: string; delay_minutes: number; enabled: boolean }[];
}) {
  const initial: SequenceStepInput[] = steps.length
    ? steps.map((s) => ({
        template_key: s.template_key,
        delay_minutes: s.delay_minutes,
        enabled: s.enabled,
      }))
    : [
        { template_key: "post_payment_activation", delay_minutes: 0, enabled: true },
        { template_key: "conversion_offer", delay_minutes: 60, enabled: true },
        { template_key: "reminder", delay_minutes: 1440, enabled: true },
        { template_key: "objection_followup", delay_minutes: 4320, enabled: true },
      ];
  const [rows, setRows] = useState<SequenceStepInput[]>(initial);
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<SequenceStepInput>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function move(i: number, dir: -1 | 1) {
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  function remove(i: number) {
    setRows((r) => r.filter((_, j) => j !== i));
  }
  function add() {
    setRows((r) => [
      ...r,
      { template_key: "reminder", delay_minutes: 1440, enabled: true },
    ]);
  }
  async function save() {
    setBusy(true);
    const r = await saveSequence(rows);
    setBusy(false);
    if ("error" in r) toast.error(r.error ?? "Failed");
    else toast.success("Sequence saved. Applies to new enrollments.");
  }
  async function reset() {
    setBusy(true);
    await resetSequence();
    setBusy(false);
    toast.success("Reset to defaults. Reload to see them.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion sequence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Changes apply to new enrollments only, not in-flight sequences.
        </p>
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
            <select
              value={row.template_key}
              onChange={(e) => update(i, { template_key: e.target.value })}
              className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            >
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={row.delay_minutes}
              onChange={(e) =>
                update(i, { delay_minutes: Number(e.target.value) })
              }
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            >
              {DELAYS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />
              On
            </label>
            <button
              type="button"
              onClick={() => move(i, -1)}
              className="px-1 text-muted-foreground"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              className="px-1 text-muted-foreground"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              className="px-1 text-destructive"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={add}>
            Add step
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save sequence"}
          </Button>
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Notifications({
  events,
  prefMap,
}: {
  events: string[];
  prefMap: Record<string, { email: boolean; in_app: boolean }>;
}) {
  const [map, setMap] = useState(prefMap);

  async function toggle(
    event: string,
    field: "email" | "in_app",
    value: boolean
  ) {
    const next = { ...map[event], [field]: value };
    setMap((m) => ({ ...m, [event]: next }));
    const r = await saveNotificationPref({
      event,
      email: field === "email" ? value : next.email,
      inApp: field === "in_app" ? value : next.in_app,
    });
    if ("error" in r) toast.error(r.error ?? "Failed");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground" />
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            In-app
          </span>
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Email
          </span>
          {events.map((e) => (
            <div key={e} className="contents">
              <span>{EVENT_LABEL[e] ?? e}</span>
              <input
                type="checkbox"
                checked={map[e]?.in_app ?? true}
                onChange={(ev) => toggle(e, "in_app", ev.target.checked)}
              />
              <input
                type="checkbox"
                checked={map[e]?.email ?? true}
                onChange={(ev) => toggle(e, "email", ev.target.checked)}
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Email is sent only once email delivery is configured for the platform.
        </p>
      </CardContent>
    </Card>
  );
}
