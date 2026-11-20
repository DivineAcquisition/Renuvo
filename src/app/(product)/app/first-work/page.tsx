import type { Metadata } from "next";

import { IssueCards } from "@/components/app/issues/issue-cards";
import { FirstWork } from "@/components/app/setup/first-work";

export const metadata: Metadata = { title: "Your first work" };

export default function Page() {
  return (
    <>
      <IssueCards place="first-work" className="mb-5" />
      <FirstWork />
    </>
  );
}
