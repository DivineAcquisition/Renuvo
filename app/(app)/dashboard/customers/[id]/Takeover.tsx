"use client";

import { useState } from "react";
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
  const [note, setNote] = useState<string | null>(null);

  async function togglePause() {
    const next = !paused;
    setPaused(next);
    await setAgentPaused(customerId, next);
  }
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setNote(null);
    const res = await sendManualMessage(customerId, text.trim());
    setBusy(false);
    if ("error" in res) setNote(res.error ?? "Could not send.");
    else {
      setText("");
      setNote("Sent.");
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
        <div className="flex items-center justify-between">
          {note && (
            <span className="text-xs text-muted-foreground">{note}</span>
          )}
          <Button
            onClick={send}
            disabled={!sendable || busy}
            className="ml-auto"
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
