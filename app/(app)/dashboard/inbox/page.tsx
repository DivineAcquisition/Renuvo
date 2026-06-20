import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { listConversations } from "@/lib/inbox/queries";
import { cn } from "@/lib/utils";

function relTime(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const active = await getActiveOrg();
  if (!active) return null;
  const filter = searchParams.filter === "needs_human" ? "needs_human" : "all";
  const rows = await listConversations(active.org.id, filter);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every SMS conversation, in one place.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {[
          { k: "all", label: "All" },
          { k: "needs_human", label: "Needs you" },
        ].map((t) => (
          <Link
            key={t.k}
            href={t.k === "all" ? "/dashboard/inbox" : "/dashboard/inbox?filter=needs_human"}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              filter === t.k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No conversations yet — they&apos;ll appear when customers reply.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.customerId}
              href={`/dashboard/inbox/${r.customerId}`}
              className="hover-lift flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9A8CFF] to-[#4F38FF] text-xs font-bold text-white">
                {r.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relTime(r.lastAt)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {r.lastDirection === "outbound" ? "You: " : ""}
                  {r.lastBody}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {r.agentPaused && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    You&apos;re handling
                  </span>
                )}
                {r.lastDirection === "inbound" && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Needs you
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
