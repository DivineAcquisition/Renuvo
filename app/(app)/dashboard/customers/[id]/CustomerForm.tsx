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
    emailConsent?: boolean;
    channelPreference?: "sms" | "email" | "any";
  };
}) {
  const router = useRouter();
  const emailChannelOn =
    process.env.NEXT_PUBLIC_EMAIL_CHANNEL_ENABLED === "true";
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [consent, setConsent] = useState(initial?.smsConsent ?? false);
  const [emailConsent, setEmailConsent] = useState(
    initial?.emailConsent ?? false
  );
  const [channelPref, setChannelPref] = useState<"sms" | "email" | "any">(
    initial?.channelPreference ?? "sms"
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await upsertCustomer({
      id: initial?.id,
      fullName,
      phone,
      email: email || undefined,
      smsConsent: consent,
      emailConsent,
      channelPreference: emailChannelOn ? channelPref : undefined,
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
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            checked={emailConsent}
            onChange={(e) => setEmailConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            This customer consented to receive email.
            <span className="block text-xs text-muted-foreground">
              Separate from texts (CAN-SPAM). Requires an email address. Every email
              includes an unsubscribe link and your business address.
            </span>
          </span>
        </label>
        {emailChannelOn && (
          <div className="space-y-1.5">
            <Label>Preferred channel</Label>
            <select
              value={channelPref}
              onChange={(e) =>
                setChannelPref(e.target.value as "sms" | "email" | "any")
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="sms">Text (SMS)</option>
              <option value="email">Email</option>
              <option value="any">Either</option>
            </select>
          </div>
        )}
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save customer"}
        </Button>
      </CardContent>
    </Card>
  );
}
