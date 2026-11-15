import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OverviewPreview } from "./preview";

export const metadata: Metadata = { title: "Overview layout preview", robots: { index: false, follow: false } };

/** The Overview's layout with made-up data, for design review. It does not exist on the production site. */
export default async function OverviewPreviewPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { panel } = await searchParams;
  return <OverviewPreview panel={panel === "1"} />;
}
