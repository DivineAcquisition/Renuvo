"use client";

import { useState } from "react";
import { toast } from "sonner";
import { exportOrgData } from "@/app/actions/data-export";
import { requestOrgDeletion, cancelOrgDeletion } from "@/app/actions/org-deletion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DataSettings({
  orgName,
  isOwner,
  deletionScheduledFor,
}: {
  orgName: string;
  isOwner: boolean;
  deletionScheduledFor: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [scheduled, setScheduled] = useState(deletionScheduledFor);

  async function exportData() {
    setBusy(true);
    const res = await exportOrgData();
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Export failed.");
      return;
    }
    const blob = new Blob([JSON.stringify(res.bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `renuvo-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export downloaded.");
  }

  async function requestDeletion() {
    if (confirmName !== orgName) {
      toast.error("Type your business name exactly to confirm.");
      return;
    }
    setBusy(true);
    const res = await requestOrgDeletion();
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Failed.");
    else {
      setScheduled(res.scheduledFor ?? null);
      toast.success("Account deletion scheduled.");
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    const res = await cancelOrgDeletion();
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Failed.");
    else {
      setScheduled(null);
      toast.success("Deletion cancelled.");
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Data &amp; privacy
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Export your data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Download a portable JSON copy of your organization&apos;s data —
            customers, plans, jobs, messages, and financial records.
          </p>
          {isOwner ? (
            <Button onClick={exportData} disabled={busy}>
              {busy ? "Preparing…" : "Export my data"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only owners can export data.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How your data is handled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Customer personal data (names, phone numbers, message contents) is
            stored to run your messaging. When a customer asks to be deleted, we
            anonymize their personal data and scrub message contents — while
            retaining the minimal opt-in/opt-out proof carrier rules require
            (stored as a one-way hash, never a readable phone list).
          </p>
          <p>
            Message contents are scrubbed after ~18 months; consent proof is kept
            for 4+ years; financial records are kept for tax/accounting.
          </p>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">
              Delete your account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {scheduled ? (
              <>
                <p className="text-sm">
                  Deletion is scheduled for{" "}
                  <span className="font-semibold">
                    {new Date(scheduled).toLocaleDateString()}
                  </span>
                  . Messaging is paused during this window. You can still cancel.
                </p>
                <Button
                  variant="outline"
                  onClick={cancelDeletion}
                  disabled={busy}
                >
                  Cancel deletion
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This starts a 14-day grace period, then permanently tears down
                  your account: your Renuvo subscription is cancelled, your
                  clients&apos; recurring billing is stopped, your texting number
                  is released, and customer data is anonymized. Legal, consent,
                  and financial records are retained as required.
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm">
                    Type <span className="font-semibold">{orgName}</span> to
                    confirm
                  </label>
                  <Input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={requestDeletion}
                  disabled={busy || confirmName !== orgName}
                >
                  Schedule account deletion
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
