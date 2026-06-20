"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveEmailSettings } from "@/app/actions/email-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EmailSettings({
  domain,
  initial,
  isOwner,
}: {
  domain: string;
  initial: {
    fromName: string;
    localPart: string;
    replyTo: string;
    postalAddress: string;
  };
  isOwner: boolean;
}) {
  const [fromName, setFromName] = useState(initial.fromName);
  const [localPart, setLocalPart] = useState(initial.localPart);
  const [replyTo, setReplyTo] = useState(initial.replyTo);
  const [postal, setPostal] = useState(initial.postalAddress);
  const [busy, setBusy] = useState(false);

  const preview = `${localPart || "yourbiz"}@${domain}`;

  async function save() {
    setBusy(true);
    const res = await saveEmailSettings({
      fromName,
      localPart,
      replyTo,
      postalAddress: postal,
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not save.");
      return;
    }
    setLocalPart(res.localPart ?? localPart);
    toast.success("Email settings saved.");
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Email sending</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You send through Renuvo&apos;s shared, authenticated domain — no DNS setup
          needed. Because the domain is shared, abuse (spam complaints, bounces) can
          pause sending across the platform, so only email customers who opted in.
        </p>
        <div className="space-y-1.5">
          <Label>From name</Label>
          <Input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Your business name"
            disabled={!isOwner}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Sending address</Label>
          <Input
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            placeholder="yourbiz"
            disabled={!isOwner}
          />
          <p className="text-xs text-muted-foreground">
            You&apos;ll send as <span className="font-medium">{preview}</span>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Reply-to (your real inbox)</Label>
          <Input
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="hello@yourbusiness.com"
            disabled={!isOwner}
          />
          <p className="text-xs text-muted-foreground">
            Customer replies go here — Renuvo doesn&apos;t read inbound email.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Business postal address (required)</Label>
          <Input
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="123 Main St, Springfield, IL 62701"
            disabled={!isOwner}
          />
          <p className="text-xs text-muted-foreground">
            U.S. law (CAN-SPAM) requires a physical address in every email. Email
            stays disabled until this is filled.
          </p>
        </div>
        <Button onClick={save} disabled={busy || !isOwner}>
          {busy ? "Saving…" : "Save email settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
