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
    <TemplateEditor
      verticalId={active.org.vertical_id}
      rows={rows}
      isOwner={active.role === "owner"}
    />
  );
}
