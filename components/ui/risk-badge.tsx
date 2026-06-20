import { cn } from "@/lib/utils";

export function RiskBadge({ level }: { level: string }) {
  const high = level === "high";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
        high
          ? "bg-destructive/10 text-destructive"
          : "bg-amber-100 text-amber-700"
      )}
    >
      {level} risk
    </span>
  );
}
