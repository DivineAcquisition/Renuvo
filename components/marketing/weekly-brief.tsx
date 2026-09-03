"use client";

import { ArrowUpRight } from "lucide-react";

import { BorderBeam } from "@/components/magicui/border-beam";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { ShineBorder } from "@/components/magicui/shine-border";

const THEMES = [
  { name: "Wait time", delta: "+41%", tone: "rising", width: 92 },
  { name: "Billing", delta: "+8%", tone: "watch", width: 46 },
  { name: "Staff · tone", delta: "new", tone: "new", width: 28 },
] as const;

export function WeeklyBrief() {
  return (
    <figure className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at 70% 30%, rgba(154,136,252,0.24) 0%, transparent 70%)",
          filter: "blur(32px)",
        }}
      />
      <div className="relative overflow-hidden rounded-[1.35rem] border border-ink-950/[0.08] bg-white shadow-desk">
        <ShineBorder borderWidth={1.25} duration={16} />
        <BorderBeam size={70} duration={10} delay={1} colorFrom="#C3B6FE" colorTo="#7E67F2" />
        <div className="flex items-center justify-between border-b border-ink-950/[0.06] px-5 py-3.5">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">
              Weekly briefing
            </p>
            <p className="mt-0.5 text-[13px] text-silver">Sep 1 – 7 · 14 notes tagged</p>
          </div>
          <span className="rounded-full border border-brand-500/20 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
            Ready
          </span>
        </div>
        <div className="grid gap-0 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="border-b border-ink-950/[0.05] p-6 lg:border-b-0 lg:border-r">
            <p className="text-[12px] font-medium text-dim">This week’s lead theme</p>
            <p className="mt-2 font-heading text-3xl tracking-tight text-ink-950">Wait time</p>
            <p className="mt-2 text-[15px] leading-relaxed text-silver">
              Up{" "}
              <span className="font-semibold text-ink-950">
                <NumberTicker value={41} />%
              </span>{" "}
              versus last week — before it becomes a pattern of lost customers.
            </p>
            <p className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">
              Sample week · wait time is the story
              <ArrowUpRight className="size-3.5" aria-hidden />
            </p>
          </div>
          <div className="space-y-4 p-6">
            {THEMES.map((theme) => (
              <div key={theme.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <p className="text-[13px] font-semibold text-ink-950">{theme.name}</p>
                  <p
                    className={
                      theme.tone === "rising"
                        ? "text-[12px] font-semibold text-brand-700"
                        : "text-[12px] font-medium text-dim"
                    }
                  >
                    {theme.delta}
                  </p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-950/[0.06]">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                    style={{ width: `${theme.width}%` }}
                  />
                </div>
              </div>
            ))}
            <blockquote className="rounded-xl border border-ink-950/[0.06] bg-brand-50/50 px-4 py-3 text-[13px] leading-relaxed text-silver">
              “Waited 40 minutes past my appointment. Nobody even apologized.”
            </blockquote>
          </div>
        </div>
      </div>
    </figure>
  );
}
