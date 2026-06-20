import { createClient } from "@/lib/supabase/server";
import { buildCaptureUrl } from "@/lib/urls";

export type LinkRow = {
  id: string;
  token: string;
  url: string;
  linkType: "customer" | "generic";
  label: string | null;
  customerId: string | null;
  customerName: string | null;
  status: string;
  openCount: number;
  createdAt: string;
  expiresAt: string | null;
  sendable: boolean;
};

function statusOf(l: {
  revoked_at: string | null;
  converted_at: string | null;
  link_type: string;
  expires_at: string | null;
  opened_at: string | null;
}) {
  if (l.revoked_at) return "revoked";
  if (l.converted_at && l.link_type === "customer") return "converted";
  if (l.expires_at && new Date(l.expires_at).getTime() < Date.now())
    return "expired";
  if (l.opened_at) return "opened";
  return "active";
}

export async function listLinks(orgId: string): Promise<LinkRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signup_links")
    .select(
      "id, token, link_type, label, customer_id, opened_at, open_count, converted_at, revoked_at, expires_at, created_at, customers(full_name, sms_sendable)"
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []).map((l) => {
    const c = l.customers as unknown as {
      full_name: string | null;
      sms_sendable: boolean | null;
    } | null;
    return {
      id: l.id as string,
      token: l.token as string,
      url: buildCaptureUrl(l.token as string),
      linkType: (l.link_type as "customer" | "generic") ?? "customer",
      label: (l.label as string | null) ?? null,
      customerId: (l.customer_id as string | null) ?? null,
      customerName: c?.full_name ?? null,
      status: statusOf({
        revoked_at: l.revoked_at,
        converted_at: l.converted_at,
        link_type: l.link_type,
        expires_at: l.expires_at,
        opened_at: l.opened_at,
      }),
      openCount: (l.open_count as number) ?? 0,
      createdAt: l.created_at as string,
      expiresAt: (l.expires_at as string | null) ?? null,
      sendable: !!c?.sms_sendable,
    };
  });
}

export async function listCustomersForPicker(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.full_name ?? c.phone ?? "Customer",
  }));
}
