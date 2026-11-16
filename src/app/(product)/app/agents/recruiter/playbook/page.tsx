import type { Metadata } from "next";

import { RecruiterPlaybookScreen } from "@/components/app/screens/recruiter/playbook";

export const metadata: Metadata = { title: "Playbook" };

export default function Page() {
  return <RecruiterPlaybookScreen />;
}
