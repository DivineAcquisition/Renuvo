import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { TemplateEditor } from "./TemplateEditor";

const EVENT_LABELS: Record<string, string> = {
  post_payment_activation: "After payment (first touch)",
  conversion_offer: "Recurring offer",
  reminder: "Reminder",
  objection_followup: "Objection follow-up",
  recurring_confirmation: "Confirmation",
  winback: "Win-back",
  save_offer: "Save offer",
};

export default async function MessagingSettings() {
  const active = await getActiveOrg();
  if (!active?.org.vertical_id)
    return (
      <p className="text-sm text-muted-foreground">Set your vertical first.</p>
    );
  const supabase = await createClient();

  // effective templates: org override → global default
  const { data: globals } = await supabase
    .from("message_templates")
    .select("event_key, body, organization_id")
    .eq("vertical_id", active.org.vertical_id);

  const byEvent: Record<string, { body: string; isOverride: boolean }> = {};
  for (const t of globals ?? []) {
    const isOverride = t.organization_id === active.org.id;
    if (!byEvent[t.event_key] || isOverride)
      byEvent[t.event_key] = { body: t.body, isOverride };
  }

  const rows = Object.keys(EVENT_LABELS).map((k) => ({
    eventKey: k,
    label: EVENT_LABELS[k],
    body: byEvent[k]?.body ?? "",
    isOverride: byEvent[k]?.isOverride ?? false,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/settings/messaging/a2p"
        className="flex items-center justify-between rounded-xl border bg-card p-4 text-sm transition-colors hover:border-primary/40"
      >
        <div>
          <p className="font-medium">SMS delivery (A2P 10DLC)</p>
          <p className="text-xs text-muted-foreground">
            Register your business so texts deliver reliably. Required before
            sending.
          </p>
        </div>
        <span className="font-medium text-primary">Set up →</span>
      </Link>
      <TemplateEditor
        verticalId={active.org.vertical_id}
        rows={rows}
        isOwner={active.role === "owner"}
      />
    </div>
  );
}
