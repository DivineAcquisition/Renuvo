import type { Metadata } from "next";

import { ApplicantsScreen } from "@/components/app/screens/recruiter/applicants";

export const metadata: Metadata = { title: "Applicants" };

export default function Page() {
  return <ApplicantsScreen />;
}
