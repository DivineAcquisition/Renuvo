import { cn } from "@/lib/utils";

/**
 * Sourced effect (Prompt 53), re-tokenized to the Renuvo brand ramp: a soft, slow
 * aurora gradient backdrop for first-impression surfaces (auth, capture, hero).
 * Pure CSS — static under `prefers-reduced-motion`. One signature per surface.
 */
export function AuroraBackground({
  className,
  dark = false,
  accent,
  children,
}: {
  className?: string;
  dark?: boolean;
  /** Optional brand accent (hex). Tenant surfaces pass the business color. */
  accent?: string | null;
  children?: React.ReactNode;
}) {
  // derive three alpha tints from a single accent hex (8-digit hex alpha)
  const accentVars = accent
    ? ({
        "--aurora-1": `${accent}8c`,
        "--aurora-2": `${accent}5e`,
        "--aurora-3": `${accent}55`,
      } as React.CSSProperties)
    : undefined;
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className={cn(
          "absolute inset-0",
          dark ? "bg-[hsl(250_35%_9%)]" : "bg-secondary/40"
        )}
        aria-hidden
      />
      <div className="aurora-bg" style={accentVars} aria-hidden />
      {children && <div className="relative">{children}</div>}
    </div>
  );
}
