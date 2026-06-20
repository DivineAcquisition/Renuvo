import { useId } from "react";
import { cn } from "@/lib/utils";

const STAR_PATH =
  "M50 3 L55 38 L73.3 26.7 L62 45 L88 50 L62 55 L73.3 73.3 L55 62 L50 97 L45 62 L26.7 73.3 L38 55 L12 50 L38 45 L26.7 26.7 L45 38 Z";

/** The Renuvo north-star mark. `gradient` fills it with the brand ramp. */
export function StarMark({
  className,
  gradient = false,
}: {
  className?: string;
  gradient?: boolean;
}) {
  const id = useId();
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {gradient && (
        <defs>
          <linearGradient id={`star-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9A8CFF" />
            <stop offset="55%" stopColor="#6A57FF" />
            <stop offset="100%" stopColor="#4F38FF" />
          </linearGradient>
        </defs>
      )}
      <path d={STAR_PATH} fill={gradient ? `url(#star-${id})` : "currentColor"} />
    </svg>
  );
}

/** Square brand badge: gradient tile with a white star, used as the logo mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-xl bg-gradient-to-br from-[#6A57FF] to-[#4F38FF] shadow-lg shadow-primary/30",
        className
      )}
    >
      <StarMark className="h-[58%] w-[58%] text-white" />
    </span>
  );
}
