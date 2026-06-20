import { useId } from "react";
import { cn } from "@/lib/utils";

// Renuvo's 6-point north star: elongated vertical (top/bottom) + 4 diagonal
// points, with concave waists at left/right (no horizontal points).
const STAR_PATH =
  "M50 2 L55.5 35 L74.4 20.9 L66 50 L74.4 79.1 L55.5 65 L50 98 L44.5 65 L25.6 79.1 L34 50 L25.6 20.9 L44.5 35 Z";

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
