import { ActorAvatar, AgentAvatar } from "@/components/app/agent";
import { ago } from "@/lib/app/format";

import type { Described, EventRef } from "../../../../convex/lib/eventWords";

/** What the team did, newest first. Every line is an event from the record and opens what it is about. */
export function ActivityFeed({ events, now, timezone, onOpen, empty }: { events: Described[]; now: number; timezone: string; onOpen: (ref: EventRef) => void; empty?: string }) {
  if (events.length === 0) return <p className="px-1 py-6 text-center text-sm text-muted-foreground">{empty ?? "Nothing has happened yet."}</p>;
  return (
    <ol className="grid gap-0.5">
      {events.map((event) => {
        const ref = event.ref;
        const body = (
          <>
            {event.actor.agent ? <AgentAvatar agent={event.actor.agent} size="sm" /> : <ActorAvatar label={event.actor.label} />}
            <span className="min-w-0 flex-1 text-sm leading-snug">
              <span className="font-medium text-strong">{event.actor.label}</span> <span className="text-foreground">{event.text}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{ago(event.at, now, timezone)}</span>
            </span>
          </>
        );
        return (
          <li key={event.id} className="live-enter">
            {ref ? (
              <button type="button" onClick={() => onOpen(ref)} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
                {body}
              </button>
            ) : (
              <div className="flex items-start gap-2.5 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
