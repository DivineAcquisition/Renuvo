"use client";

/**
 * Selestial's side of the migration: what this step is for, what it still needs, and what the checks
 * actually found in the files (saved findings, never invented). The checks are rules, so they cost nothing.
 */
import { CheckCircle2, CircleDashed, Info, TriangleAlert } from "@/components/icons";
import { cn } from "@/lib/utils";

import { useMigration } from "./context";
import { organizeIssues, STEPS } from "./steps";

const GUIDE: Record<string, string[]> = {
  source: ["Pick the system you're moving from. If you use more than one, pick the main one; you can upload files from others too.", "Choose what you want to bring. Anything Selestial can't import yet is kept and listed, never silently dropped."],
  files: ["Upload one file per kind of record if you can: customers, then upcoming bookings and recurring services.", "Selestial reads each file on its servers and shows what it found. Your originals are kept with the migration."],
  organize: ["Check each column against the values shown beside it.", "Ambiguous dates like 03/04/2027 are never guessed. Confirm how your files write them."],
  review: ["Start with “Needs attention”. Each record shows its original row beside what Selestial will make of it.", "A shared email, phone or address isn't enough to merge: households and multi-site companies share them. Choose for each."],
  import: ["The import runs in the background. You can close this page.", "Repeating it never makes a second copy."],
  verify: ["Check the counts add up, then open a few records.", "Your schedule stays on hold until you release it."],
};

export function Assistant() {
  const { view, step } = useMigration();
  const info = STEPS.find((s) => s.id === step)!;
  const findings = view.migration.notes.filter((n) => (step === "organize" ? n.step === "organize" : step === "review" ? n.step === "review" : n.step === step)).slice(-8).reverse();
  const needs = step === "organize" ? organizeIssues(view) : step === "source" && !view.migration.source ? ["Choose your current system."] : step === "files" && !view.files.some((f) => f.status === "ready") ? ["Add at least one file."] : [];

  return (
    <div className="grid gap-5 text-sm">
      <section className="grid gap-2" aria-label="About this step">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{info.label}</h3>
        <p className="text-xs text-strong">{info.purpose}</p>
        <ul className="grid gap-1.5">
          {(GUIDE[step] ?? []).map((line) => (
            <li key={line} className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </section>

      {needs.length ? (
        <section className="grid gap-2" aria-label="Still needed">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Still needed</h3>
          <ul className="grid gap-1.5">
            {needs.map((n) => (
              <li key={n} className="flex gap-2 text-xs text-strong">
                <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {n}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {findings.length ? (
        <section className="grid gap-2" aria-label="What Selestial found">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What I found</h3>
          <ul className="grid gap-2">
            {findings.map((note) => (
              <li key={note.key} className={cn("flex gap-2 rounded-lg px-3 py-2 text-xs", note.tone === "attention" ? "bg-warning/10 text-strong" : note.tone === "done" ? "bg-success/10 text-strong" : "bg-muted/50 text-strong")}>
                {note.tone === "attention" ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> : note.tone === "done" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span>{note.words}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
        These checks are Selestial&apos;s own rules for dates, money, schedules and matching. No AI model reads your files here, and nothing is charged. Text in your files is treated as data, never as instructions.
      </p>
    </div>
  );
}
