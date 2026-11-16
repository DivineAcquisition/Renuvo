import { CalendarCheckIcon, CircleDollarSign, Hand, ScheduleIcon, type LucideIcon } from "@/components/icons";
import { until } from "@/lib/app/format";
import { cn } from "@/lib/utils";

export type Indicators = {
  jobs: { total: number; completed: number; inProgress: number; upcoming: number };
  coverage: { needing: number; accepted: number; awaiting: number; partly: number; uncovered: number };
  decisions: { count: number; nextDeadline: number | null };
  payments: { state: "not_set_up" };
};

function Tile({ icon: Icon, label, value, detail, tone, onClick }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: "attention" | "good" | "muted"; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
      <span className={cn("mt-2 block font-heading text-2xl tracking-tight tabular-nums", tone === "attention" ? "text-warning-foreground" : tone === "muted" ? "text-base font-medium text-muted-foreground" : "text-strong")}>{value}</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{detail}</span>
    </>
  );
  const frame = cn("block w-full rounded-2xl border bg-card p-4 text-left", tone === "attention" ? "border-warning/50" : "border-border");
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(frame, "hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500")}>
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/** Four compact indicators. Operational problems come before money, and money says when it is not connected. */
export function IndicatorRow({ indicators, now, onSchedule, onDecisions }: { indicators: Indicators; now: number; onSchedule: () => void; onDecisions: () => void }) {
  const { jobs, coverage, decisions } = indicators;
  const open = coverage.awaiting + coverage.partly + coverage.uncovered;
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile
        icon={ScheduleIcon}
        label="Today’s jobs"
        value={String(jobs.total)}
        detail={jobs.total === 0 ? "Nothing scheduled today" : `${jobs.completed} completed · ${jobs.inProgress} in progress · ${jobs.upcoming} upcoming`}
        onClick={onSchedule}
      />
      <Tile
        icon={CalendarCheckIcon}
        label="Coverage"
        value={coverage.needing === 0 ? "—" : `${coverage.accepted} of ${coverage.needing}`}
        detail={coverage.needing === 0 ? "No visits to cover today" : open === 0 ? "Every visit has every cleaner it needs, accepted" : `${coverage.awaiting} awaiting an answer · ${coverage.partly} partly staffed · ${coverage.uncovered} with no cleaner`}
        tone={open > 0 ? "attention" : "good"}
        onClick={onSchedule}
      />
      <Tile
        icon={Hand}
        label="Needs your decision"
        value={String(decisions.count)}
        detail={decisions.nextDeadline ? `Earliest is due ${until(decisions.nextDeadline, now).text}` : "Nothing is waiting on you"}
        tone={decisions.count > 0 ? "attention" : "good"}
        onClick={onDecisions}
      />
      <Tile icon={CircleDollarSign} label="Payments due" value="Not set up yet" detail="Payments are not connected, so no amount is shown." tone="muted" />
    </div>
  );
}
