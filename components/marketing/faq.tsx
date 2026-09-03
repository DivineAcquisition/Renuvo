import { FAQ } from "@/lib/marketing/copy";
import { cn } from "@/lib/utils";

export function FaqList() {
  return (
    <div className="mx-auto max-w-2xl divide-y divide-ink-950/[0.07] overflow-hidden rounded-[1.35rem] border border-ink-950/[0.08] bg-white shadow-desk">
      {FAQ.items.map((item, index) => (
        <details
          key={item.q}
          className="group px-5 sm:px-6"
          open={index === 0}
        >
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left",
              "font-heading text-[15px] tracking-tight text-ink-950 sm:text-base",
              "marker:content-none [&::-webkit-details-marker]:hidden",
            )}
          >
            {item.q}
            <span
              aria-hidden
              className="relative size-5 shrink-0 text-brand-600 transition-transform duration-200 group-open:rotate-45"
            >
              <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-current" />
              <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-current" />
            </span>
          </summary>
          <p className="pb-5 text-[14px] leading-relaxed text-silver sm:text-[15px]">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
