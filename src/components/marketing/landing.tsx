import type { ReactNode } from "react";

import { AgentFlow } from "@/components/marketing/agent-flow";
import { AutonomyDial } from "@/components/marketing/autonomy-dial";
import { BookCall, outlineCta } from "@/components/marketing/chrome";
import { LandingFaq } from "@/components/marketing/faq";
import { GuardedRun } from "@/components/marketing/guarded-run";
import { HeroQueue } from "@/components/marketing/hero-queue";
import { BeamFrame, ShinyLabel, SpotlightCard } from "@/components/marketing/saas-frame";
import { AgentsGrid, AlwaysAPerson, ControlRules, LoopMap, PainList, Scorecard, WhoGrid } from "@/components/marketing/sections";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { WAITLIST_ANCHOR } from "@/lib/marketing/config";
import { AGENTS_SECTION, CONTROL, FAQ, FINAL_CTA, HERO, LOOP, PRICING, PROBLEM, WHO } from "@/lib/marketing/content";
import { marketingDisplayTitle, marketingLead, marketingPageGutter, marketingSectionTitle, marketingShell, marketingSubhead } from "@/lib/marketing/ui";
import { sectionLabel } from "@/lib/ui";
import { cn } from "@/lib/utils";

function Section({ id, eyebrow, headline, lead, children }: { id?: string; eyebrow?: string; headline: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn(marketingPageGutter, "scroll-mt-24 border-t border-border py-20 sm:py-28")}>
      <BlurFade inView offset={12} blur="2px" duration={0.55} className={marketingShell}>
        {eyebrow ? <p className={cn(sectionLabel, "mb-4")}>{eyebrow}</p> : null}
        <h2 className={marketingSectionTitle}>{headline}</h2>
        {lead ? <p className={cn(marketingLead, "mt-4")}>{lead}</p> : null}
        <div className="mt-10">{children}</div>
      </BlurFade>
    </section>
  );
}

export function LandingPage() {
  return (
    <>
      <section className={cn(marketingPageGutter, "relative pb-16 pt-14 sm:pb-24 sm:pt-20")}>
        <div className={cn(marketingShell, "grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr]")}>
          <div>
            <ShinyLabel>{HERO.label}</ShinyLabel>
            <h1 className={marketingDisplayTitle}>{HERO.headline}</h1>
            <p className={cn(marketingSubhead, "mt-6 max-w-xl")}>{HERO.supporting}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <BookCall position="hero">{HERO.primaryCta}</BookCall>
              <Button variant="outline" size="xl" className={outlineCta} render={<a href={WAITLIST_ANCHOR} data-cta-position="hero-waitlist" />}>
                {HERO.secondaryCta}
              </Button>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">{HERO.trust}</p>
          </div>
          <BeamFrame glow>
            <HeroQueue />
          </BeamFrame>
        </div>
      </section>

      <AgentFlow />

      <Section id={PROBLEM.id} headline={PROBLEM.headline}>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
          <div className="space-y-4 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            <p>{PROBLEM.opening}</p>
            <p className="text-strong">{PROBLEM.bridge}</p>
          </div>
          <PainList />
        </div>
      </Section>

      <Section id={AGENTS_SECTION.id} eyebrow={AGENTS_SECTION.eyebrow} headline={AGENTS_SECTION.headline} lead={AGENTS_SECTION.lead}>
        <AgentsGrid />
      </Section>

      <Section id={LOOP.id} eyebrow={LOOP.eyebrow} headline={LOOP.headline} lead={LOOP.lead}>
        <LoopMap />
      </Section>

      <Section id={CONTROL.id} eyebrow={CONTROL.eyebrow} headline={CONTROL.headline} lead={CONTROL.lead}>
        <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <AutonomyDial />
          <AlwaysAPerson />
        </div>
        <div className="mt-14">
          <GuardedRun />
        </div>
        <div className="mt-14">
          <ControlRules />
        </div>
        <div className="mt-14">
          <Scorecard />
        </div>
      </Section>

      <Section id={WHO.id} eyebrow={WHO.eyebrow} headline={WHO.headline} lead={WHO.lead}>
        <WhoGrid />
      </Section>

      <Section id={PRICING.id} headline={PRICING.headline}>
        <SpotlightCard glow className="max-w-2xl p-6">
          <h3 className="font-heading text-2xl text-strong">{PRICING.name}</h3>
          <p className="mt-2 text-lg text-strong">{PRICING.price}</p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{PRICING.body}</p>
          <BookCall position="pricing" className="mt-6">
            {PRICING.cta}
          </BookCall>
        </SpotlightCard>
      </Section>

      <Section id={FAQ.id} headline={FAQ.headline}>
        <LandingFaq />
      </Section>

      <section id={FINAL_CTA.id} className={cn(marketingPageGutter, "scroll-mt-24 border-t border-border py-20 sm:py-28")}>
        <BlurFade inView offset={12} blur="2px" duration={0.55} className={marketingShell}>
          <BeamFrame glow beamDelay={1.4} className="mx-auto max-w-3xl">
            <div className="text-center">
              <h2 className={cn(marketingSectionTitle, "mx-auto")}>{FINAL_CTA.headline}</h2>
              <p className={cn(marketingLead, "mx-auto mt-4")}>{FINAL_CTA.body}</p>
            </div>
            <div className="mt-8 border-t border-border pt-8">
              <WaitlistForm />
            </div>
          </BeamFrame>
        </BlurFade>
      </section>
    </>
  );
}
