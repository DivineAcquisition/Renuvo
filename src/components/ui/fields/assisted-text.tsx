"use client";

import { useId, useState } from "react";

import { Eye, ListChecks, Loader2, Lock, RotateCcw, TriangleAlert } from "@/components/icons";
import { joinIds, markComposite, useFieldControl } from "@/components/ui/selection/field-context";
import { focusRing } from "@/components/ui/selection/tokens";
import { cn } from "@/lib/utils";

/**
 * One way to rework the text. `kind: "template"` runs in the browser from data already on the page;
 * `kind: "ai"` calls a server action and must go through that action's credit and spending checks. Both
 * only ever produce a proposal: nothing replaces the text until the person applies it.
 */
export type WritingAction = { id: string; label: string; kind: "template" | "ai"; run: (current: string) => string | Promise<string>; disabledReason?: string };

/** Who reads this text, in the words of the permission that decides it. Callers pass what is actually true. */
export type Audience = { label: string; internal?: boolean };

/** Numbers, money and times in a text, so a rewrite that changes one can be flagged. */
function figures(text: string): string[] {
  return (text.match(/\$?\d[\d,]*(?:\.\d+)?%?|\b\d{1,2}:\d{2}\s?(?:am|pm)?\b/gi) ?? []).map((row) => row.replace(/,/g, "").toLowerCase()).sort();
}

export function changedFigures(before: string, after: string): { removed: string[]; added: string[] } {
  const [a, b] = [figures(before), figures(after)];
  const left = [...b];
  const removed: string[] = [];
  for (const item of a) {
    const at = left.indexOf(item);
    if (at === -1) removed.push(item);
    else left.splice(at, 1);
  }
  return { removed, added: left };
}

/** Puts each sentence or line on its own numbered line. Keeps every word. */
export function organizeIntoSteps(text: string): string {
  const parts = text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((row) => row.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);
  return parts.map((row, at) => `${at + 1}. ${row}`).join("\n");
}

/** A checklist as numbered lines, for "Use service checklist". */
export function fromChecklist(items: readonly string[]): string {
  return items.map((row, at) => `${at + 1}. ${row}`).join("\n");
}

type Proposal = { action: WritingAction; text: string; basedOn: string };

/**
 * A text area for business writing (scope, crew instructions, descriptions) with optional help: actions
 * that propose a new version, shown side by side before anything changes, with Apply, Keep original and
 * Undo. While an action runs the person can keep typing; the proposal never overwrites what they typed
 * without them choosing it. A rewrite that changes a number, price or time is flagged.
 */
export function AssistedTextArea({
  value,
  onChange,
  actions = [],
  audience,
  rows = 4,
  maxLength,
  disabled,
  required,
  placeholder,
  id,
  className,
  ...aria
}: {
  value: string;
  onChange: (text: string) => void;
  actions?: readonly WritingAction[];
  audience?: Audience;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const field = useFieldControl();
  const own = useId();
  const inputId = id ?? field?.controlId ?? own;
  const [running, setRunning] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  const start = async (action: WritingAction) => {
    if (running) return;
    setFailed(null);
    setRunning(action.id);
    const basedOn = value;
    try {
      const text = await action.run(basedOn);
      setProposal({ action, text: maxLength ? text.slice(0, maxLength) : text, basedOn });
    } catch {
      setFailed(action.kind === "ai" ? "That suggestion could not be prepared. Your text is unchanged, and nothing was charged unless it says so in usage." : "That could not be prepared. Your text is unchanged.");
    } finally {
      setRunning(null);
    }
  };

  const audienceId = `${inputId}-audience`;
  const edited = proposal ? proposal.basedOn !== value : false;
  const diff = proposal ? changedFigures(proposal.basedOn, proposal.text) : null;
  const figuresChanged = diff && (diff.removed.length > 0 || diff.added.length > 0);

  return (
    <div className={cn("grid gap-1.5", className)}>
      {audience ? (
        <p id={audienceId} className={cn("flex items-center gap-1.5 text-xs", audience.internal ? "text-muted-foreground" : "text-strong")}>
          {audience.internal ? <Lock className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          {audience.label}
        </p>
      ) : null}
      <textarea
        id={inputId}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        required={required ?? field?.required}
        placeholder={placeholder}
        aria-label={aria["aria-label"]}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy, audience ? audienceId : undefined)}
        onChange={(event) => {
          onChange(event.target.value);
          setUndo(null);
        }}
        className="block min-h-20 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_60%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)] aria-invalid:border-destructive/60 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground"
      />
      {!disabled && (actions.length || undo !== null || maxLength) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {actions.map((action) => (
            <button key={action.id} type="button" disabled={Boolean(running) || Boolean(action.disabledReason)} title={action.disabledReason} onClick={() => void start(action)} className={cn("inline-flex items-center gap-1 font-medium text-[var(--sel-accent,var(--brand))] hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline", focusRing)}>
              {running === action.id ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ListChecks className="size-3.5" aria-hidden />}
              {running === action.id ? `${action.label}…` : action.label}
            </button>
          ))}
          {undo !== null ? (
            <button
              type="button"
              onClick={() => {
                onChange(undo);
                setUndo(null);
              }}
              className={cn("inline-flex items-center gap-1 text-muted-foreground hover:text-strong", focusRing)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Undo
            </button>
          ) : null}
          {maxLength ? (
            <span className={cn("ml-auto tabular-nums", value.length > maxLength * 0.9 ? "text-warning-foreground" : "text-muted-foreground")}>
              {value.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {failed}
        </p>
      ) : null}
      {proposal ? (
        <div className="grid gap-2 rounded-lg border border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_25%,var(--border))] bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_4%,var(--card))] p-3 text-xs" role="group" aria-label={`Proposed text: ${proposal.action.label}`}>
          <p className="font-medium text-strong">Proposed: {proposal.action.label.toLowerCase()}</p>
          <pre className="max-h-56 overflow-auto font-sans text-sm whitespace-pre-wrap text-strong">{proposal.text}</pre>
          {figuresChanged ? (
            <p className="flex gap-1.5 text-warning-foreground">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                Check the numbers before applying: {diff!.removed.length ? `${diff!.removed.join(", ")} would go` : ""}
                {diff!.removed.length && diff!.added.length ? " and " : ""}
                {diff!.added.length ? `${diff!.added.join(", ")} would appear` : ""}.
              </span>
            </p>
          ) : null}
          {edited ? <p className="text-warning-foreground">You changed the text after this was prepared. Applying replaces your newer text; Keep original keeps it.</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setUndo(value);
                onChange(proposal.text);
                setProposal(null);
              }}
              className={cn("font-medium text-[var(--sel-accent,var(--brand))] hover:underline", focusRing)}
            >
              Apply
            </button>
            <button type="button" onClick={() => setProposal(null)} className={cn("text-muted-foreground hover:text-strong", focusRing)}>
              Keep original
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
markComposite(AssistedTextArea);
