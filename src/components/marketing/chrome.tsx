import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { CookiePreferencesLink } from "@/components/consent/banner";
import { Menu } from "@/components/icons";
import { Button, type ButtonSize } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { ASSESSMENT_PATH, FOOTER, NAV } from "@/lib/marketing/content";
import { marketingNavLink, marketingPageGutter, marketingShell } from "@/lib/marketing/ui";
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

/** The section links. Away from the home page they lead back to it. */
function NavLinks({ className, onHome }: { className?: string; onHome: boolean }) {
  return (
    <ul className={className}>
      {NAV.links.map((link) => (
        <li key={link.href}>
          <a href={onHome ? link.href : `/${link.href}`} className={cn(marketingNavLink, "block")}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteHeader({ onHome = true }: { onHome?: boolean }) {
  return (
    <header className={cn("sticky top-0 z-50 border-b border-border bg-background", marketingPageGutter)}>
      <div className={cn(marketingShell, "flex h-[4.5rem] items-center justify-between gap-4")}>
        <Link href="/" className="shrink-0 rounded-md" aria-label={`${APP_NAME} home`}>
          <Logo />
        </Link>
        <nav aria-label={onHome ? "On this page" : "Selestial"} className="hidden lg:block">
          <NavLinks onHome={onHome} className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-1" />
        </nav>
        <EarlyAccessLink position="nav" size="lg" className="hidden shrink-0 lg:inline-flex">
          {NAV.cta}
        </EarlyAccessLink>
        <details className="relative shrink-0 lg:hidden">
          <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-muted text-strong [&::-webkit-details-marker]:hidden">
            <span className="sr-only">{NAV.openMenu}</span>
            <Menu className="size-4" aria-hidden />
          </summary>
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border bg-card p-3 shadow-xl">
            <EarlyAccessLink position="nav" size="lg" className="w-full">
              {NAV.cta}
            </EarlyAccessLink>
            <nav aria-label="On this page" className="mt-2">
              <NavLinks onHome={onHome} className="grid gap-1" />
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}

/** The footer's two link groups. Every link here goes to a page that exists. */
export const FOOTER_TRUST = [
  { href: "/security", label: "Security" },
  { href: "/security/subprocessors", label: "Subprocessors" },
  { href: "/security/report", label: "Report a vulnerability" },
  { href: "/security/review", label: "Request a security review" },
] as const;

export const FOOTER_LEGAL = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
  { href: "/privacy/requests", label: "Data requests" },
  { href: "/messaging", label: "Messaging practices" },
  { href: "mailto:support@selestial.io", label: "Contact" },
] as const;

const footerLink = "rounded text-sm text-muted-foreground transition-colors hover:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]";

/**
 * The site footer. `entity` is shown only when the operator's details are verified in the trust
 * records (src/lib/trust/public.ts); otherwise only the product name appears.
 */
export function SiteFooter({ entity }: { entity?: { name: string; address: string | null } | null }) {
  return (
    <footer className={cn("border-t border-border py-12", marketingPageGutter)}>
      <div className={cn(marketingShell, "grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]")}>
        <div>
          <Logo />
          <p className="mt-3 text-sm text-strong">{FOOTER.tagline}</p>
          <p className="mt-2 text-sm text-muted-foreground">{FOOTER.roles.join(" · ")}</p>
          <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted-foreground">{FOOTER.note}</p>
        </div>
        <nav aria-labelledby="footer-trust">
          <h2 id="footer-trust" className="text-xs font-semibold tracking-[0.14em] text-strong uppercase">
            Trust
          </h2>
          <ul className="mt-3 grid gap-2">
            {FOOTER_TRUST.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={footerLink}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="text-xs font-semibold tracking-[0.14em] text-strong uppercase">
            Legal &amp; Privacy
          </h2>
          <ul className="mt-3 grid gap-2">
            {FOOTER_LEGAL.slice(0, 3).map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={footerLink}>
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <CookiePreferencesLink className={cn(footerLink, "text-left")} />
            </li>
            {FOOTER_LEGAL.slice(3).map((link) => (
              <li key={link.href}>
                {link.href.startsWith("mailto:") ? (
                  <a href={link.href} className={footerLink}>
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} className={footerLink}>
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className={cn(marketingShell, "mt-10 flex flex-col gap-1 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between")}>
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
