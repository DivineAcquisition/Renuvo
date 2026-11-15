import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** The Selestial mark: a four-point star, one point for each agent. Drawn inline so it needs no file. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <rect width="40" height="40" rx="10" fill="var(--brand)" />
      <path d="M20 7.5c.9 7.4 5.1 11.600 12.500 12.500-7.400.9-11.600 5.100-12.500 12.500-.9-7.400-5.100-11.600-12.500-12.500 7.400-.9 11.600-5.100 12.500-12.500Z" fill="#07070b" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-heading text-lg tracking-tight text-strong">{APP_NAME}</span>
    </span>
  );
}
