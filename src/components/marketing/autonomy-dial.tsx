"use client";

import { useState } from "react";

import { AgentMark, AgentName } from "@/components/marketing/agent-mark";
import { CONTROL } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const DIAL = CONTROL.dial;

/** Pick an action and a level, and read what the agent would do. It changes nothing: it shows the setting. */
export function AutonomyDial() {
  const [action, setAction] = useState(0);
  const [level, setLevel] = useState(1);
  const chosen = DIAL.actions[action];
  const chosenLevel = DIAL.levels[level];

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{DIAL.title}</h3>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-muted-foreground">{DIAL.actionLabel}</legend>
        <div className="mt-2 grid gap-1.5">
          {DIAL.actions.map((item, index) => (
            <label
              key={item.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand-500",
                index === action ? "border-brand-500/50 bg-brand-500/10 text-strong" : "border-border bg-background text-muted-foreground hover:text-strong",
              )}
            >
              <input type="radio" name="dial-action" className="sr-only" checked={index === action} onChange={() => setAction(index)} />
              <AgentMark id={item.agent} size="sm" />
              <span className="min-w-0 font-medium">{item.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-muted-foreground">{DIAL.levelLabel}</legend>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1 sm:grid-cols-4">
          {DIAL.levels.map((item, index) => (
            <label
              key={item.id}
              className={cn(
                "cursor-pointer rounded-md px-2 py-2 text-center text-xs font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand-500",
                index === level ? "bg-background text-strong shadow-sm" : "text-muted-foreground hover:text-strong",
              )}
            >
              <input type="radio" name="dial-level" className="sr-only" checked={index === level} onChange={() => setLevel(index)} />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 rounded-lg border border-border bg-background p-3.5" aria-live="polite">
        <AgentName id={chosen.agent} className="text-xs" />
        <p className="mt-1 text-sm font-medium text-strong">{chosen.label}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{chosenLevel.body}</p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{DIAL.trust}</p>
    </div>
  );
}
