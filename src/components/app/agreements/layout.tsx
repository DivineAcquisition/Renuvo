"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { Sparkles } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button-variants";
import { AGREEMENT_TABS, AGREEMENTS_ROOT } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/**
 * Every Agreements page sits inside this: the three ways to start, and the workspace's own navigation.
 * A single agreement or template opens in the same frame so the way back is always the library.
 */
export function AgreementsLayout({ children }: { children: React.ReactNode }) {
  const { companyId } = useCompany();
  const pathname = usePathname() ?? AGREEMENTS_ROOT;
  const catalog = useQuery(api.companyAgreements.catalog, { companyId });
  const canDraft = catalog ? catalog.capabilities.includes("draft") : true;
  const active = AGREEMENT_TABS.find((tab) => (tab.href === AGREEMENTS_ROOT ? pathname === AGREEMENTS_ROOT : pathname === tab.href || pathname.startsWith(`${tab.href}/`)));
  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl tracking-tight text-strong">Agreements</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Your customer, workforce and business agreements: drafts built from your own details, reviewed by a person, signed, and kept through renewal.</p>
        </div>
        {canDraft ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`${AGREEMENTS_ROOT}/new?mode=selestial`} className={buttonVariants({ variant: "primary", size: "sm" })}>
              <Sparkles aria-hidden /> Build with Selestial
            </Link>
            <Link href={`${AGREEMENTS_ROOT}/new?mode=template`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Use a Template
            </Link>
            <Link href={`${AGREEMENTS_ROOT}/new?mode=upload`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Upload Agreement
            </Link>
          </div>
        ) : null}
      </header>
      <nav aria-label="Agreements" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {AGREEMENT_TABS.map((tab) => (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={active?.id === tab.id ? "page" : undefined}
                className={cn("block border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/40", active?.id === tab.id ? "border-brand-500 font-medium text-strong" : "border-transparent text-muted-foreground hover:text-strong")}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
