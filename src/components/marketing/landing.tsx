import type { ReactNode } from "react";

import { TaskTrail } from "@/components/marketing/agent-visuals";
import { AutonomyDial } from "@/components/marketing/autonomy-dial";
import { EarlyAccessLink, outlineCta } from "@/components/marketing/chrome";
import { CoordinationMap } from "@/components/marketing/coordination-map";
import { HomeScreen } from "@/components/marketing/home-screen";
import { OwnerDecision } from "@/components/marketing/owner-decision";
import { BeamFrame, ShinyLabel } from "@/components/marketing/saas-frame";
import { AgentsGrid, ControlCards, IntegrationsGrid, LooseEnds } from "@/components/marketing/sections";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { AGENTS_SECTION, CONTROL, COORDINATION, FINAL_CTA, HERO, INTEGRATIONS, PHILOSOPHY, PROBLEM } from "@/lib/marketing/content";
import { marketingDisplayTitle, marketingLead, marketingPageGutter, marketingSectionTitle, marketingShell, marketingSubhead } from "@/lib/marketing/ui";
import { sectionLabel } from "@/lib/ui";
import { cn } from "@/lib/utils";

const sectionFrame = cn(marketingPageGutter, "scroll-mt-24 border-t border-border py-20 sm:py-28");

function Section({ id, eyebrow, headline, lead, children }: { id?: string; eyebrow?: string; headline: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className={sectionFrame}>
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
            <ShinyLabel>{HERO.eyebrow}</ShinyLabel>
            <h1 className={marketingDisplayTitle}>{HERO.headline}</h1>
            <p className={cn(marketingSubhead, "mt-6 max-w-xl")}>{HERO.supporting}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <EarlyAccessLink position="hero">{HERO.primaryCta}</EarlyAccessLink>
              <Button variant="outline" size="xl" className={outlineCta} render={<a href={`#${AGENTS_SECTION.id}`} data-cta-position="hero-agents" />}>
                {HERO.secondaryCta}
              </Button>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-relaxed font-medium text-strong">{HERO.trust}</p>
          </div>
          <BeamFrame glow>
            <HomeScreen />
          </BeamFrame>
        </div>
      </section>

      <Section id={PROBLEM.id} headline={PROBLEM.headline}>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-12">
          <LooseEnds />
          <div className="space-y-4 text-[15px] leading-relaxed sm:text-base">
            <p className="text-muted-foreground">{PROBLEM.together}</p>
            <p className="text-strong">{PROBLEM.answer}</p>
          </div>
        </div>
      </Section>

      <Section id={AGENTS_SECTION.id} headline={AGENTS_SECTION.headline}>
        <AgentsGrid />
      </Section>

      <Section id={COORDINATION.id} headline={COORDINATION.headline} lead={COORDINATION.lead}>
        <CoordinationMap />
      </Section>

      <Section id={CONTROL.id} headline={CONTROL.headline}>
        <ControlCards />
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <AutonomyDial />
          <OwnerDecision />
        </div>
      </Section>

      <Section id={INTEGRATIONS.id} headline={INTEGRATIONS.headline} lead={INTEGRATIONS.lead}>
        <IntegrationsGrid />
      </Section>

      <section id={PHILOSOPHY.id} className={sectionFrame}>
        <BlurFade inView offset={12} blur="2px" duration={0.55} className={cn(marketingShell, "max-w-4xl")}>
          <p className={cn(sectionLabel, "mb-4")}>{PHILOSOPHY.eyebrow}</p>
          <h2 className={marketingSectionTitle}>{PHILOSOPHY.headline}</h2>
          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {PHILOSOPHY.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <p className="mt-10 border-l-2 border-brand-500 pl-5 font-heading text-2xl leading-snug tracking-tight text-strong sm:text-3xl">{PHILOSOPHY.closing}</p>
          <div className="mt-12">
            <TaskTrail />
          </div>
        </BlurFade>
      </section>

      <section id={FINAL_CTA.id} className={sectionFrame}>
        <BlurFade inView offset={12} blur="2px" duration={0.55} className={marketingShell}>
          <BeamFrame glow beamDelay={1.4} className="mx-auto max-w-3xl sm:p-8">
            <h2 className={marketingSectionTitle}>{FINAL_CTA.headline}</h2>
            <div className="mt-4 space-y-3">
              {FINAL_CTA.paragraphs.map((paragraph) => (
                <p key={paragraph} className={marketingLead}>
                  {paragraph}
                </p>
              ))}
            </div>
            <div className="mt-8 flex flex-col gap-3 border-t border-border pt-8 sm:flex-row sm:items-center">
              <EarlyAccessLink position="final">{FINAL_CTA.cta}</EarlyAccessLink>
              <p className="text-sm text-muted-foreground">{FINAL_CTA.note}</p>
            </div>
          </BeamFrame>
        </BlurFade>
      </section>
    </>
  );
}
