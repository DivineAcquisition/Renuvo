"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  createCaptureLink,
  revokeCaptureLink,
  regenerateCaptureLink,
  sendCaptureLinkSms,
} from "@/app/actions/capture-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkRow } from "@/lib/links/queries";

type Filter = "all" | "active" | "converted" | "inactive";

function statusTone(s: string) {
  if (s === "converted") return "bg-emerald-100 text-emerald-700";
  if (s === "revoked" || s === "expired")
    return "bg-secondary text-muted-foreground";
  if (s === "opened") return "bg-primary/10 text-primary";
  return "bg-amber-100 text-amber-700";
}

function qrSrc(url: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    url
  )}`;
}

export function LinksView({
  links,
  customers,
}: {
  links: LinkRow[];
  customers: { id: string; name: string }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const filtered = links
    .filter((l) =>
      (l.label ?? l.customerName ?? "Generic")
        .toLowerCase()
        .includes(q.toLowerCase())
    )
    .filter((l) => {
      if (filter === "active") return ["active", "opened"].includes(l.status);
      if (filter === "converted") return l.status === "converted";
      if (filter === "inactive")
        return ["expired", "revoked"].includes(l.status);
      return true;
    });

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied.");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Capture links
          </h1>
          <p className="text-sm text-muted-foreground">
            Shareable links that enroll customers in recurring service.
          </p>
        </div>
        <Button variant="gradient" onClick={() => setShowNew(true)}>
          New link
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        {(
          [
            ["all", "All"],
            ["active", "Active"],
            ["converted", "Converted"],
            ["inactive", "Expired/Revoked"],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === k
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {showNew && (
        <NewLinkDialog
          customers={customers}
          onClose={() => setShowNew(false)}
        />
      )}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No links yet. Customer links pre-fill one client and expire; generic
            links are reusable (for your website or bio).
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => (
            <div key={l.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {l.label ?? l.customerName ?? "Generic link"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {l.linkType} · created{" "}
                    {new Date(l.createdAt).toLocaleDateString()} ·{" "}
                    <span className="font-mono">{l.openCount}</span> opens
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(
                    l.status
                  )}`}
                >
                  {l.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(l.url)}>
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setQrFor(qrFor === l.id ? null : l.id)}
                >
                  QR
                </Button>
                {l.linkType === "customer" && l.customerId && (
                  <SendButton
                    linkId={l.id}
                    customerId={l.customerId}
                    sendable={l.sendable}
                  />
                )}
                <RegenButton id={l.id} />
                <RevokeButton id={l.id} disabled={l.status === "revoked"} />
              </div>
              {qrFor === l.id && (
                <img
                  src={qrSrc(l.url)}
                  alt="QR code"
                  className="mt-3 h-44 w-44 rounded-lg border bg-white p-2"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewLinkDialog({
  customers,
  onClose,
}: {
  customers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [type, setType] = useState<"customer" | "generic">("generic");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    const res = await createCaptureLink({
      linkType: type,
      customerId: type === "customer" ? customerId : undefined,
      label: label || undefined,
      priceCents: type === "generic" ? Math.round(price * 100) : undefined,
      expiresInDays: type === "generic" ? null : undefined,
    });
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Failed.");
    else {
      setCreated(res.url ?? null);
      toast.success("Link created.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>New capture link</CardTitle>
        <button onClick={onClose} className="text-sm text-muted-foreground">
          Close
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        {created ? (
          <div className="space-y-2">
            <p className="text-sm">Your link is ready:</p>
            <Input value={created} readOnly />
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(created);
                toast.success("Copied.");
              }}
            >
              Copy
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              {(["generic", "customer"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                    type === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {type === "customer" ? (
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Offer price per visit ($)</Label>
                <Input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <Button onClick={create} disabled={busy}>
              {busy ? "Creating…" : "Create link"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SendButton({
  linkId,
  customerId,
  sendable,
}: {
  linkId: string;
  customerId: string;
  sendable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!sendable || busy}
      title={sendable ? "" : "Customer hasn't consented to texts"}
      onClick={async () => {
        setBusy(true);
        const res = await sendCaptureLinkSms(linkId, customerId);
        setBusy(false);
        if ("error" in res) toast.error(res.error ?? "Failed.");
        else toast.success("Sent via SMS.");
      }}
    >
      Send SMS
    </Button>
  );
}

function RegenButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await regenerateCaptureLink(id);
        setBusy(false);
        if ("error" in res) toast.error(res.error ?? "Failed.");
        else toast.success("New link issued.");
      }}
    >
      Regenerate
    </Button>
  );
}

function RevokeButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive"
      disabled={busy || disabled}
      onClick={async () => {
        if (!confirm("Revoke this link? It will stop working immediately.")) return;
        setBusy(true);
        const res = await revokeCaptureLink(id);
        setBusy(false);
        if ("error" in res) toast.error(res.error ?? "Failed.");
        else toast.success("Revoked.");
      }}
    >
      Revoke
    </Button>
  );
}
