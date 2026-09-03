import { ArrowUpRight, Inbox, MessageSquareWarning, Tag } from "lucide-react";

import { BorderBeam } from "@/components/magicui/border-beam";
import { ShineBorder } from "@/components/magicui/shine-border";

const THREADS = [
  {
    from: "Fwd: Google review · 2★",
    preview: "Waited 40 minutes past my appointment. Nobody even apologized.",
    tags: ["Wait time", "Front desk"],
    ago: "12m",
  },
  {
    from: "SMS · (301) · Jenna",
    preview: "You charged me twice for the same visit??",
    tags: ["Billing"],
    ago: "1h",
  },
  {
    from: "Yelp · 3★",
    preview: "The work was fine. The person at the desk made me feel rushed.",
    tags: ["Staff", "Tone"],
    ago: "3h",
  },
] as const;

export function ProductPreview() {
  return (
    <figure className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(154,136,252,0.22) 0%, transparent 70%)",
          filter: "blur(28px)",
        }}
      />
      <div className="relative overflow-hidden rounded-2xl border border-ink-950/[0.08] bg-white/90 shadow-desk">
        <ShineBorder borderWidth={1} duration={14} />
        <BorderBeam size={80} duration={8} colorFrom="#9A88FC" colorTo="#C3B6FE" borderWidth={1} />
        <div className="flex items-center gap-3 border-b border-ink-950/[0.06] px-3 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2 rounded-full bg-ink-950/20" />
            <span className="size-2 rounded-full bg-ink-950/12" />
            <span className="size-2 rounded-full bg-ink-950/12" />
          </span>
          <figcaption className="min-w-0 truncate text-[12px] font-medium tracking-wide text-dim">
            inbox.renuvo.io · this week
          </figcaption>
        </div>
        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
          <ol className="divide-y divide-ink-950/[0.05]">
            {THREADS.map((thread) => (
              <li key={thread.from} className="px-4 py-3.5 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-950">{thread.from}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-silver">{thread.preview}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {thread.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full border border-brand-500/20 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase"
                        >
                          <Tag className="size-2.5" aria-hidden />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-dim">{thread.ago}</span>
                </div>
              </li>
            ))}
          </ol>
          <aside className="border-t border-ink-950/[0.05] bg-brand-50/40 p-5 lg:border-t-0 lg:border-l">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">
              <MessageSquareWarning className="size-3.5" aria-hidden />
              Trending
            </p>
            <p className="mt-3 font-heading text-lg tracking-tight text-ink-950">Wait time</p>
            <p className="mt-1 text-[13px] leading-relaxed text-silver">
              Mentions up <span className="font-semibold text-ink-950">41%</span> vs last week —
              three reviews, two texts, one voicemail.
            </p>
            <div className="mt-5 flex h-16 items-end gap-1.5" aria-hidden>
              {[28, 34, 31, 46, 42, 58, 72].map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-sm bg-gradient-to-t from-brand-600 to-brand-400"
                  style={{ height: `${h}%`, opacity: 0.35 + i * 0.09 }}
                />
              ))}
            </div>
            <p className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700">
              <Inbox className="size-3.5" aria-hidden />
              Weekly briefing ready
              <ArrowUpRight className="size-3.5" aria-hidden />
            </p>
          </aside>
        </div>
      </div>
    </figure>
  );
}
