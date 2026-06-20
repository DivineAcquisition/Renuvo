import { cn } from "@/lib/utils";

/**
 * Sourced effect (Prompt 53), re-tokenized to the Renuvo brand ramp: a soft, slow
 * aurora gradient backdrop for first-impression surfaces (auth, capture, hero).
 * Pure CSS — static under `prefers-reduced-motion`. One signature per surface.
 */
export function AuroraBackground({
  className,
  dark = false,
  children,
}: {
  className?: string;
  dark?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className={cn(
          "absolute inset-0",
          dark ? "bg-[hsl(250_35%_9%)]" : "bg-secondary/40"
        )}
        aria-hidden
      />
      <div className="aurora-bg" aria-hidden />
      {children && <div className="relative">{children}</div>}
    </div>
  );
}
