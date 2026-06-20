"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { sendReply, setAgentPaused } from "@/app/actions/inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  type: string;
};

export function Thread({
  customerId,
  name,
  phone,
  sendable,
  agentPaused,
  messages,
}: {
  customerId: string;
  name: string;
  phone: string;
  sendable: boolean;
  agentPaused: boolean;
  messages: Msg[];
}) {
  const [paused, setPaused] = useState(agentPaused);
  const [list, setList] = useState(messages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function togglePause() {
    const next = !paused;
    setPaused(next);
    await setAgentPaused(customerId, next);
    toast.success(next ? "You're handling this conversation." : "Agent resumed.");
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const body = text.trim();
    const res = await sendReply(customerId, body);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not send.");
      return;
    }
    setList((l) => [
      ...l,
      { id: `local-${Date.now()}`, direction: "outbound", body, type: "message_sent" },
    ]);
    setText("");
    setPaused(true);
    toast.success("Sent.");
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-bold">{name}</p>
            <Link
              href={`/dashboard/customers/${customerId}`}
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {phone} · view customer
            </Link>
          </div>
          <Button
            variant={paused ? "default" : "outline"}
            size="sm"
            onClick={togglePause}
          >
            {paused ? "You're handling this" : "Agent is replying"}
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No messages yet.
            </p>
          )}
          {list.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.direction === "outbound"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-secondary"
              }`}
            >
              {m.body}
              {m.type === "message_failed" && (
                <span className="ml-2 text-[10px] opacity-80">failed</span>
              )}
            </div>
          ))}
        </div>

        {sendable ? (
          <div className="space-y-2">
            {!paused && (
              <p className="text-xs text-muted-foreground">
                Sending will pause the agent for this conversation.
              </p>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="Type a reply…"
              className="w-full rounded-md border border-input bg-background p-3 text-sm"
            />
            <div className="flex justify-end">
              <Button onClick={send} disabled={busy || !text.trim()}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
            This customer hasn&apos;t consented to texts, so you can&apos;t
            message them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
