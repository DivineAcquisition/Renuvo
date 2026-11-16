import type { Metadata } from "next";

import { InterviewsScreen } from "@/components/app/screens/recruiter/interviews";

export const metadata: Metadata = { title: "Interviews" };

export default function Page() {
  return <InterviewsScreen />;
}
