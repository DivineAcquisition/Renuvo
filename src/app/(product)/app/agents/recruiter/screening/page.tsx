import type { Metadata } from "next";

import { ScreeningScreen } from "@/components/app/screens/recruiter/screening";

export const metadata: Metadata = { title: "Screening" };

export default function Page() {
  return <ScreeningScreen />;
}
