"use client";

import { useState } from "react";
import { toast } from "sonner";
import { addAccountNote } from "@/app/actions/account-control";
import { Button } from "@/components/ui/button";

export function AccountNotes({ planId }: { planId: string }) {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await addAccountNote(planId, body, pinned);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not add note.");
      return;
    }
    setBody("");
    setPinned(false);
    toast.success("Note added.");
  }

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Add a note (only your team sees this)…"
        className="w-full rounded-md border border-input bg-background p-3 text-sm"
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          Pin to top
        </label>
        <Button size="sm" onClick={add} disabled={busy || !body.trim()}>
          {busy ? "Adding…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
