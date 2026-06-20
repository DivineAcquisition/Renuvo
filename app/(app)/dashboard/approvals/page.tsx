import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMessage } from "@/lib/agent/generate";
import { ApprovalsView } from "./ApprovalsView";
import type { Database } from "@/types/database";

type EventKey = Database["public"]["Enums"]["template_event_key"];

export default async function ApprovalsPage() {
  const active = await getActiveOrg();
  if (!active) return null;

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("scheduled_messages")
    .select(
      "id, event_key, customer_id, job_id, recurring_plan_id, customers(full_name)"
    )
    .eq("organization_id", active.org.id)
    .eq("status", "pending")
    .eq("requires_approval", true)
    .is("approved_at", null)
    .order("send_at", { ascending: true })
    .limit(25);

  const items = await Promise.all(
    (rows ?? []).map(async (r) => {
      let draft = "";
      try {
        const gen = await generateMessage({
          orgId: active.org.id,
          customerId: r.customer_id,
          eventKey: r.event_key as EventKey,
          jobId: r.job_id ?? undefined,
          planId: r.recurring_plan_id ?? undefined,
        });
        draft = gen.text;
      } catch {
        draft = "";
      }
      const customer = r.customers as unknown as {
        full_name: string | null;
      } | null;
      return {
        id: r.id as string,
        eventKey: r.event_key as string,
        customerName: customer?.full_name ?? "Customer",
        draft,
      };
    })
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Approvals
        </h1>
        <p className="text-sm text-muted-foreground">
          Review mode is on — approve drafts to let Renuvo send them.{" "}
          <Link
            href="/dashboard/settings/controls"
            className="text-primary underline"
          >
            Change automation
          </Link>
        </p>
      </div>
      <ApprovalsView items={items} />
    </div>
  );
}
