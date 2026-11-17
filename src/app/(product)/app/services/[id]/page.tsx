import type { Metadata } from "next";

import { ServiceBuilder } from "@/components/app/services/builder";

export const metadata: Metadata = { title: "Service" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceBuilder serviceId={id} />;
}
