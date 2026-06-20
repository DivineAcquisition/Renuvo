import { cn } from "@/lib/utils";

/**
 * A designed empty state (Prompt 51) — never a blank area. Use the `filtered`
 * variant when a non-empty dataset is filtered to zero (distinct from true-empty).
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="font-display text-base font-semibold">{title}</p>
      {body && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
