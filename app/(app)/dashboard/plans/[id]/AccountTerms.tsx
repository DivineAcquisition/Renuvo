"use client";

import { useState } from "react";
import { toast } from "sonner";
import { changePlanTerms, requestPaymentUpdate } from "@/app/actions/account-control";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AccountTerms({
  planId,
  currentPriceCents,
  currentCadenceId,
  cadences,
}: {
  planId: string;
  currentPriceCents: number;
  currentCadenceId: string;
  cadences: { id: string; label: string }[];
}) {
  const [price, setPrice] = useState((currentPriceCents / 100).toFixed(0));
  const [cadenceId, setCadenceId] = useState(currentCadenceId);
  const [prorate, setProrate] = useState<
    "create_prorations" | "none" | "always_invoice"
  >("create_prorations");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const newCents = Math.round(Number(price) * 100);
  const changed =
    (Number(price) > 0 && newCents !== currentPriceCents) ||
    cadenceId !== currentCadenceId;

  async function save() {
    setBusy(true);
    const res = await changePlanTerms(planId, {
      newPriceCents: newCents !== currentPriceCents ? newCents : undefined,
      newCadenceProfileId:
        cadenceId !== currentCadenceId ? cadenceId : undefined,
      prorate,
    });
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not update.");
    else toast.success("Account terms updated.");
  }

  async function reqPayment() {
    setBusy(true);
    const res = await requestPaymentUpdate(planId);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not send.");
      return;
    }
    if (res.sent) toast.success("Update link texted to the customer.");
    else {
      setLink(res.link ?? null);
      toast.info("Customer isn't textable — copy the link to send it yourself.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account terms</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Price per visit (USD)</Label>
            <input
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cadence</Label>
            <select
              value={cadenceId}
              onChange={(e) => setCadenceId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {cadences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Proration</Label>
          <select
            value={prorate}
            onChange={(e) => setProrate(e.target.value as typeof prorate)}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="create_prorations">
              Prorate (credit/charge the difference)
            </option>
            <option value="none">No proration (applies next cycle)</option>
            <option value="always_invoice">Invoice the proration now</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Changes hit the customer&apos;s live subscription on your Stripe
            account.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy || !changed}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={reqPayment} disabled={busy}>
            Request payment update
          </Button>
        </div>
        {link && (
          <p className="break-all rounded-lg bg-secondary p-2 text-xs">
            Share this secure link: {link}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
