"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upsertCustomer } from "@/app/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CustomerForm({
  initial,
}: {
  initial?: {
    id: string;
    fullName: string;
    phone: string;
    email: string;
    smsConsent: boolean;
  };
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [consent, setConsent] = useState(initial?.smsConsent ?? false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await upsertCustomer({
      id: initial?.id,
      fullName,
      phone,
      email: email || undefined,
      smsConsent: consent,
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not save.");
      return;
    }
    toast.success("Saved.");
    router.push(`/dashboard/customers/${res.id}`);
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{initial ? "Edit customer" : "Add customer"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email (optional)</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            This customer gave written or verbal consent to receive texts.
            <span className="block text-xs text-muted-foreground">
              Without consent, Renuvo cannot text them. Only check this if it&apos;s
              true — it&apos;s your compliance record.
            </span>
          </span>
        </label>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save customer"}
        </Button>
      </CardContent>
    </Card>
  );
}
