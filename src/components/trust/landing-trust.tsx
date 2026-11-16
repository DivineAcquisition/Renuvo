import Link from "next/link";

import { BlurFade } from "@/components/ui/blur-fade";
import { Activity, Lock, MessagesSquare, ShieldCheck } from "@/components/icons";
import type { PublicTrust } from "@/lib/trust/public";
import { marketingLead, marketingPageGutter, marketingSectionTitle, marketingShell } from "@/lib/marketing/ui";
import { sectionLabel } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** Which verified claim backs each card. A card appears only when its claim is verified and public. */
const CARDS = [
  { area: "permissions", title: "Permissions you control", icon: ShieldCheck },
  { area: "access", title: "Business access boundaries", icon: Lock },
  { area: "audit", title: "Actions you can trace", icon: Activity },
  { area: "messaging", title: "Communication preferences respected", icon: MessagesSquare },
] as const;

/**
 * "Your business. Your rules. Clear accountability." Each card's sentence is the published claim
 * itself, so the landing page can never say more than the evidence behind it.
 */
export function TrustSection({ trust }: { trust: PublicTrust }) {
  const cards = CARDS.flatMap((card) => {
    const claim = trust.claims.find((row) => row.area === card.area);
    return claim ? [{ ...card, text: claim.text }] : [];
  });
  return (
    <section id="trust" aria-labelledby="trust-title" className={cn(marketingPageGutter, "scroll-mt-24 border-t border-border bg-[linear-gradient(180deg,#f8f9fc_0%,#f3efff_100%)] py-20 sm:py-28")}>
      <BlurFade inView offset={12} blur="2px" duration={0.55} className={marketingShell}>
        <p className={cn(sectionLabel, "mb-4")}>Security &amp; privacy</p>
        <h2 id="trust-title" className={marketingSectionTitle}>
          Your business. Your rules. Clear accountability.
        </h2>
        <p className={cn(marketingLead, "mt-4")}>See what Selestial can access, which actions you authorize, and how customer, applicant, and cleaner information is handled.</p>
        {cards.length > 0 ? (
          <ul className={cn("mt-10 grid gap-4", cards.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : cards.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            {cards.map((card) => (
              <li key={card.area} className="rounded-2xl border border-[#e4e7ef] bg-white p-5 shadow-[0_16px_40px_-32px_rgba(33,26,53,0.35)]">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#eee8ff] text-[#5126c7]">
                  <card.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-semibold text-strong">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.text}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/security" className="icon-gradient inline-flex h-12 items-center justify-center rounded-[8px] border border-[#5126c7]/40 px-6 text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_28px_-12px_rgba(104,56,239,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]">
            Explore security &amp; privacy
          </Link>
          <Link href="/security/review" className="inline-flex h-12 items-center justify-center rounded-[8px] border border-border bg-card px-6 text-[15px] font-semibold text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]">
            Ask a security question
          </Link>
        </div>
      </BlurFade>
    </section>
  );
}
