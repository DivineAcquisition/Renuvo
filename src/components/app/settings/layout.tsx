"use client";

import { BusinessDraftProvider } from "@/components/app/settings/business-draft";
import { SettingsNav } from "@/components/app/settings/nav";

/**
 * Every Settings page sits inside this: a secondary navigation beside the page. The business draft is
 * held here, above the pages, so edits survive moving between Business & hours and Services & pricing.
 */
export function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <BusinessDraftProvider>
      <div className="grid gap-5 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-8">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </BusinessDraftProvider>
  );
}
