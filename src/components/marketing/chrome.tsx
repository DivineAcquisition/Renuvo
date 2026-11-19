import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { SiteNav } from "@/components/marketing/site-nav";
import { CookiePreferencesLink } from "@/components/consent/banner";
import { Button, type ButtonSize } from "@/components/ui/button";
import { ASSESSMENT_PATH, FOOTER, NAV } from "@/lib/marketing/content";
import { marketingPageGutter, marketingShell } from "@/lib/marketing/ui";
import { AGENT_PAGE_IDS, AGENT_PAGES, agentPagePath } from "@/lib/marketing/agent-pages";
import { cn } from "@/lib/utils";

const ctaShape = "h-12! rounded-[8px]! before:rounded-[7px]!";

/** "Get early access". Every one of these goes to the operations assessment, on its own page. */
export function EarlyAccessLink({ position, size = "xl", className, children }: { position: string; size?: ButtonSize; className?: string; children: ReactNode }) {
  return (
    <Button variant="gradient" size={size} className={cn(ctaShape, className)} render={<Link href={ASSESSMENT_PATH} data-cta-position={position} />}>
      {children}
    </Button>
  );
}

export const outlineCta = cn(ctaShape, "border-border bg-card hover:bg-muted");

/** The public site's header: the floating nav with menus (src/components/marketing/site-nav.tsx). */
export function SiteHeader({ onHome = true }: { onHome?: boolean }) {
  return <SiteNav onHome={onHome} />;
}

/**
 * The footer's link groups. Every link goes to a page or home section that exists; "/#id" works from any page.
 * "cookies" marks where the Cookie preferences control sits, since it opens a dialog rather than a page.
 */
export const FOOTER_COLUMNS: { id: string; title: string; links: { href: string; label: string }[] }[] = [
  {
    id: "product",
    title: "Product",
    links: [
      { href: "/#see-it-work", label: "See it work" },
      { href: "/#how-it-works", label: "How the agents coordinate" },
      { href: "/#platform", label: "Platform" },
      { href: "/#connections", label: "Integrations" },
      { href: "/#pricing", label: "Pricing" },
      { href: ASSESSMENT_PATH, label: "Operations assessment" },
    ],
  },
  {
    id: "agents",
    title: "Agents",
    links: [{ href: "/agents", label: "All agents" }, ...AGENT_PAGE_IDS.map((id) => ({ href: agentPagePath(id), label: AGENT_PAGES[id].status === "live" ? AGENT_PAGES[id].name : `${AGENT_PAGES[id].name} (soon)` }))],
  },
  {
    id: "company",
    title: "Company",
    links: [
      { href: "/#philosophy", label: "Our philosophy" },
      { href: "mailto:support@selestial.io", label: "Contact" },
      { href: "/sign-in", label: "Sign in" },
    ],
  },
  {
    id: "trust",
    title: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/security/subprocessors", label: "Subprocessors" },
      { href: "/security/report", label: "Report a vulnerability" },
      { href: "/security/review", label: "Request a security review" },
    ],
  },
  {
    id: "legal",
    title: "Legal & Privacy",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/cookies", label: "Cookies" },
      { href: "cookies", label: "Cookie preferences" },
      { href: "/privacy/requests", label: "Data requests" },
      { href: "/messaging", label: "Messaging practices" },
    ],
  },
];

const footerLink = "rounded text-sm text-muted-foreground transition-colors hover:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]";

function FooterLink({ href, label }: { href: string; label: string }) {
  if (href === "cookies") return <CookiePreferencesLink className={cn(footerLink, "text-left")} />;
  // In-page and mail links stay plain anchors so the browser scrolls and opens them as usual.
  if (href.startsWith("/#") || href.startsWith("mailto:") || href === "/sign-in") {
    return (
      <a href={href} className={footerLink}>
        {label}
      </a>
    );
  }
  return (
    <Link href={href} className={footerLink}>
      {label}
    </Link>
  );
}

/**
 * The site footer. `entity` is shown only when the operator's details are verified in the trust
 * records (src/lib/trust/public.ts); otherwise only the product name appears.
 */
export function SiteFooter({ entity }: { entity?: { name: string; address: string | null } | null }) {
  return (
    <footer className={cn("border-t border-border py-14", marketingPageGutter)}>
      <div className={cn(marketingShell, "grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[1.5fr_repeat(5,minmax(0,1fr))]")}>
        <div className="col-span-2 sm:col-span-3 lg:col-span-1">
          <Logo />
          <p className="mt-3 text-sm text-strong">{FOOTER.tagline}</p>
          <p className="mt-6 max-w-xs text-xs leading-relaxed text-muted-foreground">{FOOTER.note}</p>
          <EarlyAccessLink position="footer" size="lg" className="mt-5">
            Get early access
          </EarlyAccessLink>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.id} aria-labelledby={`footer-${column.id}`}>
            <h2 id={`footer-${column.id}`} className="text-xs font-semibold tracking-[0.14em] text-strong uppercase">
              {column.title}
            </h2>
            <ul className="mt-3 grid gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <FooterLink href={link.href} label={link.label} />
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className={cn(marketingShell, "mt-12 flex flex-col gap-1 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between")}>
        <p>
          © {new Date().getFullYear()} {entity?.name ?? FOOTER.name}
          {entity?.name ? <span> · {FOOTER.name} is operated by {entity.name}</span> : null}
        </p>
        {entity?.address ? <p>{entity.address}</p> : null}
      </div>
    </footer>
  );
}

export function SkipToContent() {
  return (
    <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:inline-flex focus:h-9 focus:items-center focus:rounded-lg focus:bg-primary focus:px-3.5 focus:text-[13px] focus:font-medium focus:text-primary-foreground">
      {NAV.skipToContent}
    </a>
  );
}
