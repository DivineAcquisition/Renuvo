"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useCompany } from "@/components/app/company";
import { Plus, Sparkles, TemplateIcon, Upload } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button-variants";
import { SERVICES_ROOT, SERVICES_TABS } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/**
 * Every Services & Pricing page sits inside this: the four ways to start, and the workspace's tabs. A
 * single service, change or brief opens in the same frame, so the way back is always one tab away.
 */
export function ServicesLayout({ children }: { children: React.ReactNode }) {
  const { companyId, role } = useCompany();
  const pathname = usePathname() ?? SERVICES_ROOT;
  const catalog = useQuery(api.services.catalog, { companyId });
  const migrate = useMutation(api.services.migrateFromSettings);
  const asked = useRef(false);
  const canDraft = role === "owner" || role === "manager";
  // The Owner's services from Settings move into the one catalog the first time the Owner opens it.
  useEffect(() => {
    if (asked.current || !catalog || catalog.legacyWaiting === 0 || !catalog.canPublish) return;
    asked.current = true;
    void migrate({ companyId }).catch(() => undefined);
  }, [catalog, companyId, migrate]);

  const active = SERVICES_TABS.find((tab) => (tab.href === SERVICES_ROOT ? pathname === SERVICES_ROOT || /^\/app\/services\/(?!studio|research|changes)[^/]+/.test(pathname) : pathname === tab.href || pathname.startsWith(`${tab.href}/`)));
  return (
    <div className="grid grid-cols-1 gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl tracking-tight text-strong">Services & Pricing</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">What you sell, how each service is priced, and what it earns. Changes are drafted, checked and reviewed before a customer ever sees them.</p>
        </div>
        {canDraft ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`${SERVICES_ROOT}/new?mode=selestial`} className={buttonVariants({ variant: "primary", size: "sm" })}>
              <Sparkles aria-hidden /> Build with Selestial
            </Link>
            <Link href={`${SERVICES_ROOT}/new?mode=template`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <TemplateIcon aria-hidden /> Use a template
            </Link>
            <Link href={`${SERVICES_ROOT}/new?mode=blank`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Plus aria-hidden /> Add a service
            </Link>
            <Link href={`${SERVICES_ROOT}/new?mode=import`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Upload aria-hidden /> Import existing pricing
            </Link>
          </div>
        ) : null}
      </header>
      <nav aria-label="Services & Pricing" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {SERVICES_TABS.map((tab) => (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={active?.id === tab.id ? "page" : undefined}
                className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/40", active?.id === tab.id ? "border-brand-500 font-medium text-strong" : "border-transparent text-muted-foreground hover:text-strong")}
              >
                {tab.label}
                {tab.id === "changes" && catalog && catalog.counts.waiting > 0 ? (
                  <span className="rounded-full bg-brand-500/10 px-1.5 text-xs font-medium text-brand-700 dark:text-brand-200">{catalog.counts.waiting} waiting</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
      <p className="text-xs text-muted-foreground">These are your company&apos;s prices for your customers. Selestial&apos;s own plans and credits are under Settings › Plan &amp; Usage.</p>
    </div>
  );
}
