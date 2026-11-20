import type { Metadata } from "next";

import { IssueCards } from "@/components/app/issues/issue-cards";
import { EmailPreviews } from "@/components/app/settings/email-previews";
import { NotificationPreferences } from "@/components/app/settings/notification-preferences";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return (
    <SectionPage id="notifications">
      <div className="grid gap-10">
        <IssueCards place="notifications" />
        <NotificationPreferences />
        <section aria-labelledby="email-previews" className="grid gap-3">
          <div>
            <h2 id="email-previews" className="font-heading text-lg text-strong">Email previews</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">Every email Selestial sends to your team, and the ones it sends to your customers, applicants and cleaners on your company&apos;s behalf.</p>
          </div>
          <EmailPreviews />
        </section>
      </div>
    </SectionPage>
  );
}
