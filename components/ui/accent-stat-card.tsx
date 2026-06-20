import { cn } from "@/lib/utils";
import { CountUp, type CountUpFormat } from "./count-up";

/** The signature MRR card: gradient border, gradient-text value, sheen sweep. */
export function AccentStatCard({
  label,
  value,
  format = "money",
  sub,
  trend,
  className,
}: {
  label: string;
  value: number;
  format?: CountUpFormat;
  sub?: string;
  trend?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "accent-border accent-sheen hover-lift relative overflow-hidden rounded-2xl p-5 shadow-sm",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="gradient-text mt-2 text-3xl font-bold tracking-tight">
        <CountUp value={value} format={format} />
      </p>
      <div className="mt-1 flex items-center gap-2">
        {trend && (
          <span className="text-xs font-semibold text-emerald-600">
            ▲ {trend}
          </span>
        )}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
