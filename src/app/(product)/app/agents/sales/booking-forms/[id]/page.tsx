import type { Metadata } from "next";

import { ExperienceBuilder } from "@/components/app/booking/builder";

import type { Id } from "../../../../../../../../convex/_generated/dataModel";

export const metadata: Metadata = { title: "Booking experience" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperienceBuilder experienceId={id as Id<"bookingExperiences">} />;
}
