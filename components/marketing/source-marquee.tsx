import {
  Facebook,
  Instagram,
  Mail,
  MessageCircle,
  Smartphone,
  Star,
  Voicemail,
  BarChart3,
} from "lucide-react";

import { Marquee } from "@/components/magicui/marquee";
import { SOURCES } from "@/lib/marketing/copy";

const ICONS = [Star, MessageCircle, Smartphone, Voicemail, Instagram, Facebook, Mail, BarChart3];

export function SourceMarquee() {
  return (
    <div className="relative overflow-hidden border-y border-ink-950/[0.06] bg-white/60">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#fbfbfe] to-transparent sm:w-24"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#fbfbfe] to-transparent sm:w-24"
      />
      <Marquee pauseOnHover className="py-4 [--duration:38s]">
        {SOURCES.map((source, index) => {
          const Icon = ICONS[index] ?? Star;
          return (
            <span
              key={source}
              className="mx-1.5 inline-flex items-center gap-2 rounded-full border border-ink-950/[0.08] bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink-950 shadow-sm"
            >
              <Icon className="size-3.5 text-brand-600" aria-hidden />
              {source}
            </span>
          );
        })}
      </Marquee>
    </div>
  );
}
