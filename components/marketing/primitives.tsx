import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { MagicCard } from "@/components/magicui/magic-card";
import { Panel } from "@/components/ui/panel";
import {
  marketingBody,
  marketingCardTitle,
} from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">
      {children}
    </p>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-brand-500/20 bg-white/75 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase shadow-sm backdrop-blur-md">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
      </span>
      {children}
    </p>
  );
}

export function FeatureCard({
  step,
  icon: Icon,
  title,
  children,
}: {
  step?: string;
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel className="flex h-full flex-col overflow-hidden p-0">
      <MagicCard className="flex h-full flex-col rounded-2xl p-6 sm:p-7">
        <div className="relative z-10 flex h-full flex-col">
        {Icon ? (
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-brand-500/[0.08] text-brand-600">
            <Icon className="size-5" aria-hidden />
          </div>
        ) : null}
        {step ? (
          <p className="mb-3 text-[11px] font-bold tracking-[0.16em] text-brand-700 uppercase">
            Step {step}
          </p>
        ) : null}
        <h3 className={marketingCardTitle}>{title}</h3>
        <div className={cn(marketingBody, "mt-3")}>{children}</div>
        </div>
      </MagicCard>
    </Panel>
  );
}

export function IconCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel className="flex h-full flex-col overflow-hidden p-0">
      <MagicCard className="flex h-full flex-col rounded-2xl p-5 sm:p-6">
        <div className="relative z-10">
        <div className="flex size-10 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/[0.08] text-brand-600">
          <Icon className="size-5" aria-hidden />
        </div>
        <h3 className={cn(marketingCardTitle, "mt-5")}>{title}</h3>
        <div className={cn(marketingBody, "mt-2")}>{children}</div>
        </div>
      </MagicCard>
    </Panel>
  );
}
