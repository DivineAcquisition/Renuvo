import type { Metadata } from "next";

import { IssueCards } from "@/components/app/issues/issue-cards";
import { TextingWorkspace } from "@/components/app/texting/workspace";

export const metadata: Metadata = { title: "Set up business texting" };

export default function Page() {
  return (
    <>
      <IssueCards place="texting" className="mb-5" />
      <TextingWorkspace />
    </>
  );
}
