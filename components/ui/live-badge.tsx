export function LiveBadge({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {label}
    </span>
  );
}
