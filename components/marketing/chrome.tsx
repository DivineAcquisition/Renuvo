import type { ReactNode } from "react";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { NAV } from "@/lib/marketing/copy";

function MarketingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute -top-[24%] left-1/2 h-[640px] w-[920px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(154,136,252,0.22) 0%, transparent 68%)",
          filter: "blur(72px)",
        }}
      />
      <div
        className="absolute top-[22%] right-[-10%] h-[420px] w-[420px]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(154,136,252,0.12) 0%, transparent 70%)",
          filter: "blur(64px)",
        }}
      />
      <div
        className="absolute bottom-[-8%] left-[-8%] h-[320px] w-[320px]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(126,103,242,0.1) 0%, transparent 70%)",
          filter: "blur(70px)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(30,25,64,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(30,25,64,0.035) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 85% 55% at 50% -5%, black 20%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 85% 55% at 50% -5%, black 20%, transparent 75%)",
        }}
      />
    </div>
  );
}

export function SkipToContent() {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:inline-flex focus:h-9 focus:items-center focus:rounded-lg focus:bg-primary focus:px-3.5 focus:text-[13px] focus:font-medium focus:text-primary-foreground"
    >
      {NAV.skipToContent}
    </a>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#fbfbfe] text-ink-950 antialiased">
      <SkipToContent />
      <MarketingBackdrop />
      <div className="relative z-10">
        <SiteHeader />
        <main id="content">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
