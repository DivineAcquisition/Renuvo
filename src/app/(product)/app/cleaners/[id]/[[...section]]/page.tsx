import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CleanerProfileScreen } from "@/components/app/cleaners/profile-screen";
import { isSection } from "@/lib/app/cleaners";

export const metadata: Metadata = { title: "Cleaner" };

/** One cleaner's profile, and each of its sections at its own address: /app/cleaners/<id>/<section>. */
export default async function Page({ params }: { params: Promise<{ id: string; section?: string[] }> }) {
  const { id, section } = await params;
  const name = section?.[0] ?? "overview";
  if ((section?.length ?? 0) > 1 || !isSection(name) || !/^[a-z0-9]{8,64}$/i.test(id)) notFound();
  return <CleanerProfileScreen cleanerId={id} section={name} />;
}
