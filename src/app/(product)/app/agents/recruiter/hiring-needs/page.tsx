import type { Metadata } from "next";

import { HiringNeedsScreen } from "@/components/app/screens/recruiter/hiring-needs";

export const metadata: Metadata = { title: "Hiring Needs" };

export default function Page() {
  return <HiringNeedsScreen />;
}
