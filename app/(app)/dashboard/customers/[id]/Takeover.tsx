"use client";

import { useState } from "react";
import { toast } from "sonner";
import { sendManualMessage, setAgentPaused } from "@/app/actions/takeover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Takeover({
  customerId,
  sendable,
  agentPaused,
}: {
  customerId: string;
  sendable: boolean;
  agentPaused: boolean;
}) {
  const [paused, setPaused] = useState(agentPaused);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function togglePause() {
    const next = !paused;
    setPaused(next);
    await setAgentPaused(customerId, next);
    toast.success(next ? "Agent paused." : "Agent resumed.");
  }
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await sendManualMessage(customerId, text.trim());
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not send.");
    else {
      setText("");
      toast.success("Message sent.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Take over</CardTitle>
        <Button
          variant={paused ? "default" : "outline"}
          size="sm"
          onClick={togglePause}
        >
          {paused ? "Agent paused" : "Pause agent"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!sendable && (
          <p className="text-sm text-destructive">
            This customer isn&apos;t reachable (no consent / opted out).
          </p>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Text this customer directly…"
          rows={3}
          disabled={!sendable}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        <div className="flex items-center justify-end">
          <Button onClick={send} disabled={!sendable || busy}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
