import type { Metadata } from "next";

import { BookingFormPage } from "@/components/sales/form-page";

export const metadata: Metadata = { title: "Request a quote", robots: { index: false, follow: false, nocache: true } };

export default async function Page({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ embed?: string | string[] }> }) {
  const { publicId } = await params;
  // `?embed=1` is the form inside a company's own website: no page chrome around it.
  const embed = (await searchParams).embed === "1";
  return <BookingFormPage publicId={publicId} embed={embed} />;
}
