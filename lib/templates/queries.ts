import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables, Enums } from "@/types/database";

export type MessageTemplate = Tables<"message_templates">;
export type TemplateEventKey = Enums<"template_event_key">;

export type EffectiveTemplate = {
  eventKey: TemplateEventKey;
  body: string;
  /** true when the org has its own override; false when falling back to global. */
  isOverride: boolean;
};

/**
 * Resolve the effective body for an org/vertical/event via the resolve_template
 * RPC (org override → global fallback). Returns null if neither exists.
 */
export async function resolveTemplate(
  orgId: string,
  verticalId: string,
  eventKey: TemplateEventKey
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_template", {
    p_org_id: orgId,
    p_vertical_id: verticalId,
    p_event_key: eventKey,
  });

  if (error) {
    throw new Error(`Failed to resolve template: ${error.message}`);
  }

  return (data as string | null) ?? null;
}

/**
 * Every event_key for a vertical with its EFFECTIVE body and an `isOverride`
 * flag (true if the org has its own row, false if falling back to global).
 * Powers the settings editor (Prompt 25).
 */
export async function listTemplates(
  orgId: string,
  verticalId: string
): Promise<EffectiveTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("event_key, body, organization_id")
    .eq("vertical_id", verticalId)
    .eq("is_active", true)
    .or(`organization_id.eq.${orgId},organization_id.is.null`);

  if (error) {
    throw new Error(`Failed to list templates: ${error.message}`);
  }

  const rows = (data ?? []) as Pick<
    MessageTemplate,
    "event_key" | "body" | "organization_id"
  >[];

  // Collapse global + org rows per event_key, preferring the org override.
  const effective = new Map<TemplateEventKey, EffectiveTemplate>();
  for (const row of rows) {
    const isOrg = row.organization_id === orgId;
    const current = effective.get(row.event_key);
    if (!current || (isOrg && !current.isOverride)) {
      effective.set(row.event_key, {
        eventKey: row.event_key,
        body: row.body,
        isOverride: isOrg,
      });
    }
  }

  return Array.from(effective.values());
}

/**
 * Create or update the org's override row for an event_key. Global defaults are
 * never touched (and aren't writable via the API anyway).
 */
export async function upsertOrgTemplate(
  orgId: string,
  verticalId: string,
  eventKey: TemplateEventKey,
  body: string
): Promise<MessageTemplate> {
  const supabase = await createClient();

  const { data: existing, error: findError } = await supabase
    .from("message_templates")
    .select("id")
    .eq("organization_id", orgId)
    .eq("vertical_id", verticalId)
    .eq("event_key", eventKey)
    .maybeSingle();

  if (findError) {
    throw new Error(`Failed to look up org template: ${findError.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from("message_templates")
      .update({ body })
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    if (error) {
      throw new Error(`Failed to update org template: ${error.message}`);
    }
    return data as MessageTemplate;
  }

  const { data, error } = await supabase
    .from("message_templates")
    .insert({
      organization_id: orgId,
      vertical_id: verticalId,
      event_key: eventKey,
      body,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create org template: ${error.message}`);
  }

  return data as MessageTemplate;
}
