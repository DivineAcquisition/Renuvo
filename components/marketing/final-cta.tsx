import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { BorderBeam } from "@/components/magicui/border-beam";
import { Particles } from "@/components/magicui/particles";
import { ShineBorder } from "@/components/magicui/shine-border";
import { Button } from "@/components/ui/button";
import { HERO, TRUST } from "@/lib/marketing/copy";
import {
  marketingPageGutter,
  marketingSectionY,
  marketingShell,
} from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

export function FinalCta() {
  return (
    <section
      id="start"
      className={cn("scroll-mt-24 border-t border-ink-950/[0.06]", marketingPageGutter, marketingSectionY)}
    >
      <div
        className={cn(
          marketingShell,
          "relative overflow-hidden rounded-[1.85rem] px-6 py-16 text-center sm:px-12 sm:py-24",
        )}
      >
        <ShineBorder borderWidth={1.25} duration={14} shineColor={["#9A88FC", "#C3B6FE", "#7E67F2"]} />
        <BorderBeam size={110} duration={10} colorFrom="#9A88FC" colorTo="#C3B6FE" />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(154,136,252,0.28), transparent 55%), linear-gradient(180deg, #0b0a11 0%, #16151f 100%)",
          }}
        />
        <Particles className="absolute inset-0" quantity={36} color="#C3B6FE" ease={90} size={0.4} />
        <div className="relative">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-300 uppercase">
            Free to start
          </p>
          <h2 className="mx-auto mt-4 max-w-2xl font-heading font-normal text-3xl tracking-tight text-white sm:text-5xl sm:leading-[1.08]">
            {HERO.cta}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/60 sm:text-lg">
            {TRUST.line}
          </p>
          <div className="mt-9 flex justify-center">
            <Button variant="gradient" size="xl" className="rounded-xl px-7" asChild>
              <Link href="/signup">
                {HERO.cta}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
