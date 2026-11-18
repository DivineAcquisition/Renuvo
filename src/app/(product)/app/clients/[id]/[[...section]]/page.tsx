import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientProfileScreen } from "@/components/app/clients/profile";
import { isRecordId, isTab } from "@/lib/app/clients";

export const metadata: Metadata = { title: "Client" };

/**
 * One client, each tab at its own address: /app/clients/<id>/<tab>. A property has its own address inside
 * Properties: /app/clients/<id>/properties/<propertyId>.
 */
export default async function Page({ params }: { params: Promise<{ id: string; section?: string[] }> }) {
  const { id, section } = await params;
  const tab = section?.[0] ?? "overview";
  const propertyId = section?.[1];
  if (!isRecordId(id) || !isTab(tab) || (section?.length ?? 0) > 2) notFound();
  if (propertyId !== undefined && (tab !== "properties" || !isRecordId(propertyId))) notFound();
  return <ClientProfileScreen customerId={id} tab={tab} propertyId={propertyId ?? null} />;
}
