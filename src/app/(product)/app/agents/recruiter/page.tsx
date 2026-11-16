import type { Metadata } from "next";

import { RecruiterOverviewScreen } from "@/components/app/screens/recruiter/overview";

export const metadata: Metadata = { title: "Recruiter" };

export default function Page() {
  return <RecruiterOverviewScreen />;
}
