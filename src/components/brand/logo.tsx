import { cn } from "@/lib/utils";

/** The Renuvo mark: a rounded square with a turning arc, for "renew". Drawn inline so it needs no file. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <rect width="40" height="40" rx="10" fill="var(--brand)" />
      <path d="M27.5 20a7.5 7.5 0 1 1-2.6-5.7" fill="none" stroke="#07070b" strokeWidth="3" strokeLinecap="round" />
      <path d="M26.2 9.6v5.6h-5.6" fill="none" stroke="#07070b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-heading text-lg tracking-tight text-strong">Renuvo</span>
    </span>
  );
}
