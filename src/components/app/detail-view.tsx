import { ActorAvatar, AgentAvatar, eyebrow } from "@/components/app/agent";
import { ActivityFeed } from "@/components/app/overview/activity-feed";
import { RunTrace } from "@/components/app/run-trace";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { money, until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { Detail } from "../../../convex/details";
import type { EventRef } from "../../../convex/lib/eventWords";

const TONE: Record<Detail["status"]["tone"], NonNullable<BadgeProps["variant"]>> = { good: "success", pending: "info", attention: "warning", neutral: "outline" };

const ASSIGNMENT_WORDS: Record<string, string> = { offered: "Offered · not accepted", accepted: "Accepted", declined: "Declined", expired: "No answer in time", cancelled: "Released" };
/** A cancelled assignment says why it ended. Only a person's release reads as "Released". */
const ENDED_WORDS: Record<string, string> = { job_covered: "Offer withdrawn · place filled", job_cancelled: "Visit cancelled", job_moved: "Ended · visit moved", dropped: "Could not attend", no_show: "No-show", undelivered: "Text not delivered" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4 sm:px-6">
      <h3 className={eyebrow}>{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/**
 * The one detail layout, the same for a visit, an approval and a task:
 * current situation, relevant context, next action, ways to step in, history.
 */
export function DetailView({ detail, now, timezone, onOpen, actions }: { detail: Detail; now: number; timezone: string; onOpen: (ref: EventRef) => void; actions?: React.ReactNode }) {
  const next = detail.next;
  const due = next.when ? until(next.when, now) : null;
  return (
    <div>
      <header className="px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pr-14">
        <Badge variant={TONE[detail.status.tone]} size="sm">
          {detail.status.label}
        </Badge>
        <h2 className="mt-2 font-heading text-xl leading-snug tracking-tight text-strong">{detail.title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail.subtitle}</p>
        <p className="mt-3 flex items-center gap-2 text-sm">
          {detail.responsible.agent ? <AgentAvatar agent={detail.responsible.agent} size="xs" /> : <ActorAvatar label={detail.responsible.label} />}
          <span className="text-muted-foreground">Responsible:</span> <span className="font-medium text-strong">{detail.responsible.label}</span>
        </p>
      </header>

      <Section title="Current situation">
        <div className="grid gap-1.5 text-sm leading-relaxed text-strong">
          {detail.situation.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
        {detail.job && detail.job.staffing.required > 1 && detail.job.status !== "cancelled" ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Crew: <span className="font-medium text-strong tabular-nums">{detail.job.staffing.accepted} of {detail.job.staffing.required}</span> accepted
            {detail.job.staffing.offersOut > 0 ? ` · ${detail.job.staffing.offersOut} ${detail.job.staffing.offersOut === 1 ? "offer" : "offers"} out` : ""}
          </p>
        ) : null}
        {detail.job && detail.job.assignments.length > 0 ? (
          <ul className="mt-3 grid gap-1.5">
            {detail.job.assignments.map((row) => (
              <li key={row.id} className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm", row.status === "accepted" ? "border-success/40 bg-success/5" : row.status === "offered" ? "border-dashed border-warning/60" : "border-border opacity-70")}>
                <span>
                  <span className="font-medium text-strong">{row.cleaner}</span>{" "}
                  <span className="text-muted-foreground">
                    · {row.status === "cancelled" && row.endCause ? (ENDED_WORDS[row.endCause] ?? ASSIGNMENT_WORDS.cancelled) : ASSIGNMENT_WORDS[row.status]}
                    {row.role && detail.job!.staffing.required > 1 && (row.status === "accepted" || row.status === "offered") ? ` · ${row.role}` : ""}
                    {row.status === "accepted" && row.checkedInAt ? " · checked in" : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {money(row.payCents)} pay{row.status === "offered" ? ` · answer due ${whenLabel(row.respondBy, now, timezone)}` : ""}
                  {row.endReason && row.status !== "offered" && row.status !== "accepted" ? ` · ${row.endReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Relevant context">
        <dl className="grid gap-2 text-sm">
          {detail.context.map((fact) => {
            const ref = fact.ref;
            return (
              <div key={fact.label} className="grid grid-cols-[8.5rem_1fr] gap-3">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className={cn("min-w-0 break-words", fact.missing ? "text-muted-foreground italic" : "text-strong")}>
                  {ref ? (
                    <button type="button" onClick={() => onOpen(ref)} className="text-left font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                      {fact.value}
                    </button>
                  ) : (
                    fact.value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </Section>

      <Section title="Next action">
        <p className="text-sm font-medium leading-relaxed text-strong">{next.action}</p>
        {next.when && due ? (
          <p className={cn("mt-1 text-sm", due.late ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>
            {whenLabel(next.when, now, timezone)} · {due.text}
          </p>
        ) : null}
        {next.ifFails ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold">If it fails:</span> {next.ifFails}
          </p>
        ) : null}
      </Section>

      {detail.job && detail.job.run.length > 0 ? (
        <Section title="Dispatch’s run on this visit">
          <RunTrace steps={detail.job.run} />
        </Section>
      ) : null}

      {actions ? <Section title="Step in">{actions}</Section> : null}

      <Section title="History">
        <ActivityFeed events={detail.history} now={now} timezone={timezone} onOpen={onOpen} empty="Nothing recorded yet." />
      </Section>
    </div>
  );
}
