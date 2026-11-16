import type { Metadata } from "next";
import Link from "next/link";

import { LogoMark } from "@/components/brand/logo";
import { SiteFooter, SiteHeader, SkipToContent } from "@/components/marketing/chrome";
import { EarlyAccessForm } from "@/components/marketing/early-access-form";
import { ASSESSMENT_PAGE, ASSESSMENT_PATH } from "@/lib/marketing/content";
import { marketingLead, marketingPageGutter, marketingSectionTitle } from "@/lib/marketing/ui";
import { sectionLabel } from "@/lib/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: ASSESSMENT_PAGE.title,
  description: ASSESSMENT_PAGE.lead,
  alternates: { canonical: ASSESSMENT_PATH },
};

/** The operations assessment, on its own page: seven questions about the business, then how to reach the person. */
export default function AssessmentPage() {
  return (
    <>
      <SkipToContent />
      <SiteHeader onHome={false} />
      <main id="content" className={cn(marketingPageGutter, "pb-20 pt-10 sm:pb-28 sm:pt-16")}>
        <div className="mx-auto max-w-2xl">
          <LogoMark className="size-14 shadow-[0_12px_30px_-14px_rgba(104,56,239,0.8)]" />
          <p className={cn(sectionLabel, "mt-6")}>{ASSESSMENT_PAGE.eyebrow}</p>
          <h1 className={cn(marketingSectionTitle, "mt-3")}>{ASSESSMENT_PAGE.headline}</h1>
          <p className={cn(marketingLead, "mt-4")}>{ASSESSMENT_PAGE.lead}</p>
          <div className="mt-10 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
            <EarlyAccessForm />
          </div>
          <p className="mt-6 text-sm">
            <Link href="/" className="font-medium text-[#5126c7] underline-offset-4 hover:underline">
              ← {ASSESSMENT_PAGE.back}
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
