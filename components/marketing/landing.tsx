import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { MagicCard } from "@/components/magicui/magic-card";
import { Marquee } from "@/components/magicui/marquee";
import { Particles } from "@/components/magicui/particles";
import { ProductPreview } from "@/components/marketing/product-preview";
import { Button } from "@/components/ui/button";
import { HERO, HOW_IT_WORKS, SOURCES, TRUST } from "@/lib/marketing/copy";
import {
  marketingBody,
  marketingCardTitle,
  marketingHeroTitle,
  marketingPageGutter,
  marketingSectionTitle,
  marketingSectionY,
  marketingShell,
  marketingSubhead,
} from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-brand-500/20 bg-white/70 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase shadow-sm backdrop-blur">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
      </span>
      {children}
    </p>
  );
}

export function LandingPage() {
  const accentAt = HERO.headline.indexOf(HERO.headlineAccent);
  const before = accentAt >= 0 ? HERO.headline.slice(0, accentAt) : HERO.headline;
  const after = accentAt >= 0 ? HERO.headline.slice(accentAt + HERO.headlineAccent.length) : "";

  return (
    <>
      <section className={cn(marketingPageGutter, "relative overflow-hidden pb-20 pt-14 sm:pb-28 sm:pt-24")}>
        <Particles className="absolute inset-0 z-0" quantity={42} color="#9A88FC" ease={80} size={0.45} />
        <div className={cn(marketingShell, "relative z-10 grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div className="animate-rise">
            <StatusPill>
              <AnimatedShinyText className="mx-0 max-w-none text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">
                No CRM · no new habit
              </AnimatedShinyText>
            </StatusPill>
            <h1 className={cn(marketingHeroTitle, "mt-6")}>
              {before}
              <span className="text-gradient">{HERO.headlineAccent}</span>
              {after}
            </h1>
            <p className={cn(marketingSubhead, "mt-6 max-w-xl")}>{HERO.subhead}</p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button variant="gradient" size="xl" className="rounded-xl px-5" asChild>
                <Link href="/signup">
                  {HERO.cta}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <a
                href="#how"
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-silver transition-colors hover:text-ink-950"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 max-w-md text-[13px] leading-relaxed text-dim">{TRUST.line}</p>
          </div>
          <div className="relative animate-rise delay-1">
            <ProductPreview />
          </div>
        </div>
      </section>

      <div className="relative overflow-hidden border-y border-ink-950/[0.06] bg-white/50">
        <Marquee pauseOnHover className="[--duration:36s]">
          {SOURCES.map((source) => (
            <span
              key={source}
              className="mx-4 text-[13px] font-medium tracking-wide text-silver"
            >
              {source}
            </span>
          ))}
        </Marquee>
      </div>

      <section
        id="how"
        className={cn("scroll-mt-24 border-t border-ink-950/[0.06]", marketingPageGutter, marketingSectionY)}
      >
        <div className={marketingShell}>
          <p className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">
            {HOW_IT_WORKS.eyebrow}
          </p>
          <h2 className={marketingSectionTitle}>{HOW_IT_WORKS.headline}</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {HOW_IT_WORKS.steps.map((step, index) => (
              <BlurFade key={step.title} delay={0.08 * index} inView>
                <div className="panel relative flex h-full flex-col overflow-hidden rounded-2xl">
                  <MagicCard className="flex h-full flex-col rounded-2xl p-6 sm:p-7">
                    <p className="mb-5 text-4xl font-semibold leading-none tracking-tight text-brand-500/30 tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className={marketingCardTitle}>{step.title}</h3>
                    <p className={cn(marketingBody, "mt-3")}>{step.body}</p>
                  </MagicCard>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      <section
        id="patterns"
        className={cn(
          "scroll-mt-24 border-t border-ink-950/[0.06] bg-white/40",
          marketingPageGutter,
          marketingSectionY,
        )}
      >
        <div className={cn(marketingShell, "grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16")}>
          <div>
            <p className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">
              Weekly, not noisy
            </p>
            <h2 className={marketingSectionTitle}>See the pattern before it becomes churn.</h2>
            <p className={cn(marketingSubhead, "mt-4 max-w-lg")}>
              One forwarded inbox. Every complaint tagged. A quiet briefing that tells you what
              shifted this week — wait time, billing, staff, product — before it hardens into lost
              customers.
            </p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section
        id="start"
        className={cn("scroll-mt-24 border-t border-ink-950/[0.06]", marketingPageGutter, marketingSectionY)}
      >
        <div className={cn(marketingShell, "relative overflow-hidden rounded-[1.75rem] px-6 py-14 text-center sm:px-12 sm:py-20")}>
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 50% 0%, rgba(154,136,252,0.22), transparent 55%), linear-gradient(180deg, #0b0a11 0%, #16151f 100%)",
            }}
          />
          <div className="relative">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-300 uppercase">
              Free to start
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl font-heading text-3xl tracking-tight text-white sm:text-4xl">
              {HERO.cta}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/60">
              {TRUST.line}
            </p>
            <div className="mt-8 flex justify-center">
              <Button variant="gradient" size="xl" className="rounded-xl px-6" asChild>
                <Link href="/signup">
                  {HERO.cta}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
