"use client";

import { useState } from "react";
import { toast } from "sonner";
import { approveMessage, rejectMessage } from "@/app/actions/approvals";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Item = {
  id: string;
  eventKey: string;
  customerName: string;
  draft: string;
};

export function ApprovalsView({ items }: { items: Item[] }) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing waiting for approval.
        </CardContent>
      </Card>
    );
  }

  async function approve(id: string, body: string) {
    setBusy(id);
    const r = await approveMessage(id, body);
    setBusy(null);
    if ("error" in r) toast.error(r.error ?? "Failed");
    else {
      toast.success("Approved — sending shortly.");
      setRows((rs) => rs.filter((x) => x.id !== id));
    }
  }
  async function reject(id: string) {
    setBusy(id);
    const r = await rejectMessage(id);
    setBusy(null);
    if ("error" in r) toast.error(r.error ?? "Failed");
    else {
      toast.success("Rejected.");
      setRows((rs) => rs.filter((x) => x.id !== id));
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((item) => (
        <ApprovalRow
          key={item.id}
          item={item}
          busy={busy === item.id}
          onApprove={approve}
          onReject={reject}
        />
      ))}
    </div>
  );
}

function ApprovalRow({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: Item;
  busy: boolean;
  onApprove: (id: string, body: string) => void;
  onReject: (id: string) => void;
}) {
  const [body, setBody] = useState(item.draft);
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{item.customerName}</p>
          <span className="text-xs text-muted-foreground">{item.eventKey}</span>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onReject(item.id)}
          >
            Reject
          </Button>
          <Button
            size="sm"
            disabled={busy || !body.trim()}
            onClick={() => onApprove(item.id, body)}
          >
            {busy ? "…" : "Approve & send"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
