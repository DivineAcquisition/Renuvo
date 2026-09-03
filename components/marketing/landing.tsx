import { ArrowRight, CalendarClock, Forward, Inbox, PlugZap, Repeat, ScanSearch, Tags, Unplug } from "lucide-react";
import Link from "next/link";

import { Particles } from "@/components/magicui/particles";
import { FaqList } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import {
  Eyebrow,
  FeatureCard,
  IconCard,
  StatusPill,
} from "@/components/marketing/primitives";
import { ProductPreview } from "@/components/marketing/product-preview";
import { SourceMarquee } from "@/components/marketing/source-marquee";
import { WeeklyBrief } from "@/components/marketing/weekly-brief";
import { Button } from "@/components/ui/button";
import { FAQ, HERO, HOW_IT_WORKS, PATTERNS, TRUST, WHY } from "@/lib/marketing/copy";
import {
  marketingHeroTitle,
  marketingPageGutter,
  marketingSectionTitle,
  marketingSectionY,
  marketingShell,
  marketingSubhead,
} from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

const STEP_ICONS = [Forward, ScanSearch, CalendarClock] as const;
const WHY_ICONS = [Unplug, Repeat, PlugZap, Tags, CalendarClock, Inbox] as const;

export function LandingPage() {
  const accentAt = HERO.headline.indexOf(HERO.headlineAccent);
  const before = accentAt >= 0 ? HERO.headline.slice(0, accentAt) : HERO.headline;
  const after = accentAt >= 0 ? HERO.headline.slice(accentAt + HERO.headlineAccent.length) : "";

  return (
    <>
      <section className={cn(marketingPageGutter, "relative overflow-hidden pb-16 pt-12 sm:pb-28 sm:pt-24")}>
        <Particles className="absolute inset-0 z-0" quantity={52} color="#9A88FC" ease={80} size={0.5} />
        <div className={cn(marketingShell, "relative z-10 grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16")}>
          <div className="animate-rise">
            <StatusPill>No CRM · no new habit</StatusPill>
            <h1 className={cn(marketingHeroTitle, "mt-6")}>
              {before}
              <span className="text-gradient">{HERO.headlineAccent}</span>
              {after}
            </h1>
            <p className={cn(marketingSubhead, "mt-6 max-w-xl")}>{HERO.subhead}</p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button variant="gradient" size="xl" className="rounded-xl px-6" asChild>
                <Link href="/signup">
                  {HERO.cta}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <a
                href="#how"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-sm font-medium text-silver transition-colors hover:text-ink-950"
              >
                {HERO.secondaryCta}
              </a>
            </div>
            <p className="mt-5 max-w-md text-[13px] leading-relaxed text-dim">{TRUST.line}</p>
          </div>
          <div className="relative animate-rise delay-1">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section className="border-y border-ink-950/[0.06] bg-white/55">
        <div className={cn(marketingShell, marketingPageGutter, "grid gap-8 py-10 sm:grid-cols-3 sm:py-14")}>
          {TRUST.promises.map((item) => (
            <div key={item.label} className="text-center">
              <p className="font-heading text-4xl tracking-tight text-ink-950 sm:text-5xl">
                {item.value}
              </p>
              <p className="mt-2 text-[13px] font-medium text-silver sm:text-sm">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <SourceMarquee />

      <section
        id="how"
        className={cn("scroll-mt-24 border-t border-ink-950/[0.06]", marketingPageGutter, marketingSectionY)}
      >
        <div className={cn(marketingShell, "max-w-5xl")}>
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>{HOW_IT_WORKS.eyebrow}</Eyebrow>
            <h2 className={cn(marketingSectionTitle, "mx-auto")}>{HOW_IT_WORKS.headline}</h2>
            <p className={cn(marketingSubhead, "mx-auto mt-3")}>{HOW_IT_WORKS.lead}</p>
          </div>
          <div className="relative mt-12 grid gap-4 md:grid-cols-3 md:gap-6">
            <div
              aria-hidden
              className="pointer-events-none absolute left-[8%] right-[8%] top-10 hidden h-px bg-gradient-to-r from-transparent via-brand-400/50 to-transparent md:block"
            />
            {HOW_IT_WORKS.steps.map((step, index) => (
              <FeatureCard
                key={step.title}
                step={String(index + 1).padStart(2, "0")}
                icon={STEP_ICONS[index]}
                title={step.title}
              >
                {step.body}
              </FeatureCard>
            ))}
          </div>
        </div>
      </section>

      <section
        className={cn(
          "border-t border-ink-950/[0.06] bg-white/40",
          marketingPageGutter,
          marketingSectionY,
        )}
      >
        <div className={marketingShell}>
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>{WHY.eyebrow}</Eyebrow>
            <h2 className={cn(marketingSectionTitle, "mx-auto")}>{WHY.headline}</h2>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY.items.map((item, index) => (
              <IconCard key={item.title} icon={WHY_ICONS[index]} title={item.title}>
                {item.body}
              </IconCard>
            ))}
          </div>
        </div>
      </section>

      <section
        id="patterns"
        className={cn("scroll-mt-24 border-t border-ink-950/[0.06]", marketingPageGutter, marketingSectionY)}
      >
        <div className={cn(marketingShell, "grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16")}>
          <div>
            <Eyebrow>{PATTERNS.eyebrow}</Eyebrow>
            <h2 className={marketingSectionTitle}>{PATTERNS.headline}</h2>
            <p className={cn(marketingSubhead, "mt-4 max-w-lg")}>{PATTERNS.body}</p>
          </div>
          <WeeklyBrief />
        </div>
      </section>

      <section
        id="faq"
        className={cn(
          "scroll-mt-24 border-t border-ink-950/[0.06] bg-white/40",
          marketingPageGutter,
          marketingSectionY,
        )}
      >
        <div className={marketingShell}>
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>{FAQ.eyebrow}</Eyebrow>
            <h2 className={cn(marketingSectionTitle, "mx-auto")}>{FAQ.headline}</h2>
          </div>
          <div className="mt-10">
            <FaqList />
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}
