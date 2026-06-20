export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-2">
        <div className="shimmer h-7 w-40 rounded-md" />
        <div className="shimmer h-4 w-56 rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="shimmer h-4 w-24 rounded" />
            <div className="shimmer mt-3 h-8 w-28 rounded" />
            <div className="shimmer mt-2 h-3 w-20 rounded" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="shimmer h-72 rounded-2xl lg:col-span-2" />
        <div className="shimmer h-72 rounded-2xl" />
      </div>
    </div>
  );
}
