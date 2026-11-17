import type { Metadata } from "next";

import { CleanerProfilePage } from "@/components/app/cleaners/profile";

export const metadata: Metadata = { title: "Cleaner" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CleanerProfilePage cleanerId={id} />;
}
