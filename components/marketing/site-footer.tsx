import Link from "next/link";

import Logo from "@/components/brand/logo";
import { APP_OWNER, CONTACT_EMAIL } from "@/lib/constants";
import { marketingPageGutter, marketingShell } from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

const footerLink =
  "text-sm text-silver transition-colors hover:text-brand-700 focus-visible:text-ink-950";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-ink-950/[0.06]">
      <div className={cn(marketingShell, marketingPageGutter, "py-10 sm:py-12")}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" aria-label="Renuvo home" className="inline-block">
              <Logo />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-dim">
              Patterns in the feedback you already get — before they cost you customers.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Product</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <a href="#how" className={footerLink}>
                  How it works
                </a>
              </li>
              <li>
                <Link href="/signup" className={footerLink}>
                  Start free
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Company</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className={footerLink}>
                  Contact
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Legal</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link href="/privacy" className={footerLink}>
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className={footerLink}>
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-3 border-t border-ink-950/[0.05] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-dim">© {APP_OWNER}. All rights reserved.</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className={cn(footerLink, "text-xs font-medium")}>
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
