"use client";

import { useState } from "react";
import { toast } from "sonner";
import { pausePlan, resumePlan, cancelPlan } from "@/app/actions/plan-lifecycle";
import { Button } from "@/components/ui/button";

export function PlanActions({
  planId,
  status,
}: {
  planId: string;
  status: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run(
    fn: () => Promise<{ error?: string } | { ok?: boolean }>,
    ok: string
  ) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if ("error" in res && res.error) toast.error(res.error);
    else toast.success(ok);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "active" && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => run(() => pausePlan(planId), "Plan paused.")}
        >
          Pause
        </Button>
      )}
      {status === "paused" && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => run(() => resumePlan(planId), "Plan resumed.")}
        >
          Resume
        </Button>
      )}
      {status !== "cancelled" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="text-destructive"
          onClick={() => {
            if (
              confirm(
                "Cancel this plan? Future billing stops; past charges are unaffected."
              )
            )
              run(() => cancelPlan(planId), "Plan cancelled.");
          }}
        >
          Cancel plan
        </Button>
      )}
    </div>
  );
}
