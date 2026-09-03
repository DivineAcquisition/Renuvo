"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import Logo from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { HERO, NAV } from "@/lib/marketing/copy";
import {
  marketingNavLink,
  marketingPageGutter,
  marketingShell,
} from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-ink-950/[0.06] bg-white/75 backdrop-blur-xl hairline-glow">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/50 to-transparent"
      />
      <div
        className={cn(
          marketingShell,
          marketingPageGutter,
          "flex h-16 items-center justify-between gap-4",
        )}
      >
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" aria-label="Renuvo home" className="shrink-0 rounded-sm">
            <Logo className="h-8" />
          </Link>
          <nav aria-label="Page" className="hidden md:block">
            <ul className="flex items-center gap-1">
              <li>
                <a href="#how" className={marketingNavLink}>
                  {NAV.how}
                </a>
              </li>
              <li>
                <a href="#patterns" className={marketingNavLink}>
                  {NAV.patterns}
                </a>
              </li>
              <li>
                <a href="#faq" className={marketingNavLink}>
                  {NAV.faq}
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/login">{NAV.signIn}</Link>
          </Button>
          <Button variant="gradient" size="lg" className="hidden sm:inline-flex" asChild>
            <Link href="/signup">{HERO.cta}</Link>
          </Button>
          <Button variant="gradient" size="sm" className="sm:hidden" asChild>
            <Link href="/signup">Start free</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-4" />
          </Button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-ink-950/[0.06] bg-white px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            <a
              href="#how"
              className="rounded-xl px-3 py-3 text-base font-medium text-ink-950"
              onClick={() => setOpen(false)}
            >
              {NAV.how}
            </a>
            <a
              href="#patterns"
              className="rounded-xl px-3 py-3 text-base font-medium text-ink-950"
              onClick={() => setOpen(false)}
            >
              {NAV.patterns}
            </a>
            <a
              href="#faq"
              className="rounded-xl px-3 py-3 text-base font-medium text-ink-950"
              onClick={() => setOpen(false)}
            >
              {NAV.faq}
            </a>
            <Link
              href="/login"
              className="rounded-xl px-3 py-3 text-base font-medium text-silver"
              onClick={() => setOpen(false)}
            >
              {NAV.signIn}
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
