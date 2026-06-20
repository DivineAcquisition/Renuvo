"use client";

import { useState } from "react";
import { toast } from "sonner";
import { adminSuspend, adminUnsuspend } from "@/app/admin/actions";

export function AdminTenantActions({
  orgId,
  suspended,
}: {
  orgId: string;
  suspended: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function suspend() {
    if (!reason.trim()) {
      toast.error("Enter a reason.");
      return;
    }
    if (!confirm("Suspend this tenant's messaging immediately?")) return;
    setBusy(true);
    const res = await adminSuspend(orgId, reason.trim());
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Failed");
    else toast.success("Tenant messaging suspended.");
  }
  async function unsuspend() {
    setBusy(true);
    const res = await adminUnsuspend(orgId);
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Failed");
    else toast.success("Tenant messaging restored.");
  }

  if (suspended) {
    return (
      <button
        onClick={unsuspend}
        disabled={busy}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
      >
        {busy ? "…" : "Unsuspend messaging"}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="h-9 w-full rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/40"
      />
      <button
        onClick={suspend}
        disabled={busy}
        className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "…" : "Suspend messaging (kill-switch)"}
      </button>
    </div>
  );
}
