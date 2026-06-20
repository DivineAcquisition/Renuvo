import { cn } from "@/lib/utils";
import { CountUp, type CountUpFormat } from "./count-up";
import { Sparkline } from "./sparkline";

export function StatCard({
  label,
  value,
  format = "int",
  sub,
  sparkline,
  className,
}: {
  label: string;
  value: number;
  format?: CountUpFormat;
  sub?: string;
  sparkline?: number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "hover-lift rounded-2xl border bg-card p-5 shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {sparkline && sparkline.length > 1 && (
          <Sparkline points={sparkline} />
        )}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight">
        <CountUp value={value} format={format} />
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
