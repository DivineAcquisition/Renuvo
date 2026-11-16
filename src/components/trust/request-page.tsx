import type { ReactNode } from "react";

import { PublicPage } from "@/components/trust/public-page";
import type { PublicTrust } from "@/lib/trust/public";

/** The layout shared by the three public request pages: what this is for on the left, the form on the right. */
export function RequestPage({ trust, eyebrow, title, lead, aside, children }: { trust: PublicTrust; eyebrow: string; title: string; lead: string; aside: ReactNode; children: ReactNode }) {
  return (
    <PublicPage trust={trust}>
      <div className="px-5 pt-10 pb-20 sm:px-6 sm:pt-14 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#5126c7] uppercase">{eyebrow}</p>
            <h1 className="mt-3 font-heading text-4xl tracking-tight text-[#211a35] sm:text-5xl">{title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-[#3d3654]">{lead}</p>
            <div className="mt-8 grid gap-5 text-[15px] leading-relaxed text-[#3d3654] [&_a]:font-medium [&_a]:text-[#5126c7] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:font-semibold [&_h2]:text-[#211a35]">{aside}</div>
          </div>
          <div className="h-fit rounded-3xl border border-[#e4e7ef] bg-white p-5 shadow-[0_1px_2px_rgba(33,26,53,0.04),0_12px_32px_-16px_rgba(81,38,199,0.18)] sm:p-7">{children}</div>
        </div>
      </div>
    </PublicPage>
  );
}

/** "Or email privacy@…", only when that address is verified. */
export function EmailInstead({ address }: { address: string | null }) {
  if (!address) return null;
  return (
    <p>
      You can also email <a href={`mailto:${address}`}>{address}</a>.
    </p>
  );
}
