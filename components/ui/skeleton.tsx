import { cn } from "@/lib/utils";

/** Content-shaped loading placeholder (Prompt 51) — use instead of a spinner. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} />;
}

/** A stack of skeleton rows, shaped like a list/table. */
export function SkeletonRows({
  n = 5,
  className,
}: {
  n?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-xl border p-3"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton grid of stat cards (the common dashboard header shape). */
export function SkeletonStats({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-2xl border bg-card p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-28" />
        </div>
      ))}
    </div>
  );
}
