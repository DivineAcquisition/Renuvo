"use client";

import Link from "next/link";

import { PageHeader } from "@/components/app/shell";
import { RecruitingRules } from "@/components/app/settings/recruiting";

/** Recruiter's playbook: the hiring inbox, invitations and reminders, sending hours, sender, interviews, offers and the Owner's own rules. The same settings as Settings › Recruiting. */
export function RecruiterPlaybookScreen() {
  return (
    <>
      <PageHeader
        title="Playbook"
        lead="How Recruiter works for you: the inbox it reads, when it writes, and the rules it follows."
        actions={
          <Link href="/app/settings/agents" className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            What Recruiter may do without asking
          </Link>
        }
      />
      <RecruitingRules />
    </>
  );
}
