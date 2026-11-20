"use client";

/**
 * After the import: the activation review (what each workflow would do with the imported records, what's
 * missing, the messages it would likely send and what they'd cost, what still needs approval), and undo for
 * records nobody has touched since. Both are deliberate: nothing starts or disappears without the Owner's
 * confirmation.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Check, CircleDashed, Loader2, RotateCcw, Rocket, ShieldCheck, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { KIND_LABELS, type FileKind } from "../../../../convex/lib/migration/rules";
import { plural, useMigration } from "./context";
import { Note, Section } from "./parts";

const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });

export function ActivationReview() {
  const { companyId, act } = useMigration();
  const review = useQuery(api.migration.activationReview, { companyId });
  const release = useMutation(api.migration.release);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [sure, setSure] = useState(false);
  if (!review) return null;
  const waiting = review.workflows.filter((w) => w.count > 0 && !w.released);
  const done = review.workflows.filter((w) => w.released);
  if (!waiting.length && !done.length) return null;
  const pick = (id: string) => chosen[id] ?? false;
  const picked = waiting.filter((w) => pick(w.id));
  const messages = picked.reduce((n, w) => n + w.messages, 0);
  const cost = picked.reduce((n, w) => n + w.costCents, 0);
  const ready = review.status === "imported" || review.status === "released";

  return (
    <Section title="Activation review" lead="Imported visits, recurring services and team members are on hold. Turn on each workflow when you're ready. Here's exactly what each would do.">
      <div className="grid gap-3">
        {review.workflows.filter((w) => w.count > 0 || w.released).map((w) => {
          const on = pick(w.id);
          return (
            <div key={w.id} className={cn("grid gap-3 rounded-2xl border p-4", w.released ? "border-success/40 bg-success/5" : on ? "border-brand-500 bg-brand-500/[0.05]" : "border-border bg-card")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-strong">
                    {w.title}
                    <Badge variant="outline">{w.agent}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{w.records}</p>
                </div>
                {w.released ? (
                  <Badge variant="success">
                    <Check className="size-3" aria-hidden />
                    On since {new Date(w.released).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </Badge>
                ) : review.canRelease ? (
                  <label className="flex items-center gap-2 text-xs font-medium text-strong">
                    <input type="checkbox" checked={on} onChange={(e) => setChosen((c) => ({ ...c, [w.id]: e.target.checked }))} />
                    Turn on
                  </label>
                ) : null}
              </div>
              {!w.released ? (
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="grid content-start gap-1">
                    <p className="font-semibold text-strong">What it does</p>
                    <ul className="grid gap-1 text-muted-foreground">
                      {w.does.map((line) => (
                        <li key={line} className="flex gap-1.5">
                          <CircleDashed className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {line}
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">Agent control: <span className="font-medium text-strong">{w.level}</span></p>
                  </div>
                  <div className="grid content-start gap-1">
                    <p className="font-semibold text-strong">Messages and cost (estimate)</p>
                    <p className="text-muted-foreground">{w.messagesWords}</p>
                    {w.messages ? <p className="text-muted-foreground">About <span className="font-medium text-strong">{dollars(w.costCents)}</span> in messaging at {dollars(review.rate.textCents)} a text segment, charged as they&apos;re sent.</p> : null}
                  </div>
                  {w.missing.length ? (
                    <ul className="grid gap-1 sm:col-span-2">
                      {w.missing.map((m) => (
                        <li key={m} className="flex gap-1.5 text-warning-foreground">
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {m}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {w.approvals.length ? (
                    <ul className="grid gap-1 sm:col-span-2">
                      {w.approvals.map((m) => (
                        <li key={m} className="flex gap-1.5 text-strong">
                          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-brand-300" aria-hidden />
                          {m}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <ul className="grid gap-1 rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          {review.untouched.map((line) => (
            <li key={line} className="flex gap-1.5">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        {waiting.length ? (
          review.canRelease ? (
            <div className="grid gap-2 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.06] to-transparent p-4">
              <p className="text-sm text-strong">
                {picked.length ? (
                  <>
                    Turning on <span className="font-semibold">{picked.map((w) => w.agent).join(", ")}</span>
                    {messages ? <> · about {plural(messages, "message")} to your team · about {dollars(cost)}</> : null}
                  </>
                ) : (
                  "Choose the workflows to turn on."
                )}
              </p>
              {review.undoRunning ? <Note tone="warning">An undo is running. Turn workflows on once it finishes.</Note> : null}
              {!ready ? <Note tone="warning">Finish the import first.</Note> : null}
              <label className="flex items-start gap-2 text-xs text-strong">
                <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                I&apos;ve reviewed what each chosen workflow will do and want it to start working with my imported records.
              </label>
              <Button
                variant="gradient"
                className="justify-self-start"
                disabled={!sure || !picked.length || !ready || review.undoRunning}
                onClick={() =>
                  void act(async () => {
                    await release({ companyId, confirm: true, visits: pick("visits"), plans: pick("plans"), team: pick("team") });
                    setChosen({});
                    setSure(false);
                  })
                }
              >
                <Rocket aria-hidden />
                Turn on {picked.length ? plural(picked.length, "workflow") : "workflows"}
              </Button>
            </div>
          ) : (
            <Note>Your company&apos;s Owner turns these on, because they start work with your team.</Note>
          )
        ) : null}
      </div>
    </Section>
  );
}

export function UndoPanel() {
  const { companyId, act } = useMigration();
  const preview = useQuery(api.migration.undoPreview, { companyId });
  const undo = useMutation(api.migration.undo);
  const [kinds, setKinds] = useState<Set<FileKind>>(new Set());
  const [sure, setSure] = useState(false);
  if (!preview) return null;
  const order: string[] = ["customers", "properties", "cleaners", "recurring", "bookings", "history", "balances"];
  const entries = (Object.entries(preview.kinds) as [FileKind, { undoable: number; kept: { name: string; reason: string }[] }][]).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const running = preview.undo?.status === "running";
  if (!entries.length && !preview.undo) return null;
  const toggle = (kind: FileKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const total = entries.filter(([k]) => kinds.has(k) || kinds.has("customers")).reduce((n, [, v]) => n + v.undoable, 0);

  return (
    <Section title="Undo imported records" lead="Removes records this import created that nobody has touched since. It isn't a full rollback: anything edited, paid, messaged, offered or used stays, and says why. Opt-outs from your files always stay.">
      {running ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Undoing: {preview.undo!.undone} removed, {preview.undo!.kept} kept so far. You can leave this page.
        </p>
      ) : preview.undo?.status === "done" ? (
        <Note tone={preview.undo.kept ? "warning" : "done"}>
          Last undo: {plural(preview.undo.undone, "record")} removed{preview.undo.kept ? `, ${preview.undo.kept} kept because they were changed or used` : ""}. Undone rows are skipped in Review &amp; fix; take back the skip to import one again.
        </Note>
      ) : null}
      {entries.length ? (
        <div className="grid gap-2">
          {entries.map(([kind, v]) => (
            <div key={kind} className="grid gap-1.5 rounded-xl border border-border p-3 text-xs">
              <label className="flex flex-wrap items-center gap-2">
                {preview.canUndo ? <input type="checkbox" checked={kinds.has(kind) || (kind !== "customers" && kinds.has("customers"))} disabled={running || (kind !== "customers" && kinds.has("customers"))} onChange={() => toggle(kind)} /> : null}
                <span className="text-sm font-medium text-strong">{KIND_LABELS[kind].label}</span>
                <span className="text-muted-foreground">
                  {v.undoable} can be undone{v.kept.length ? ` · ${v.kept.length} will stay` : ""}
                </span>
                {kind === "customers" ? <span className="text-muted-foreground">(includes everything that belongs to them)</span> : null}
              </label>
              {v.kept.length ? (
                <ul className="grid gap-0.5 pl-6 text-muted-foreground">
                  {v.kept.slice(0, 8).map((k, i) => (
                    <li key={`${k.name}-${i}`}>
                      <span className="font-medium text-strong">{k.name}</span>: {k.reason}
                    </li>
                  ))}
                  {v.kept.length > 8 ? <li>…and {v.kept.length - 8} more, listed in your report.</li> : null}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {preview.canUndo && entries.length ? (
        <div className="grid gap-2">
          <label className="flex items-start gap-2 text-xs text-strong">
            <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            I understand {total ? plural(total, "record") : "the chosen records"} will be removed from Selestial. Records that stay need to be changed on the record itself.
          </label>
          <Button
            variant="destructive-outline"
            className="justify-self-start"
            disabled={!sure || !kinds.size || running}
            onClick={() =>
              void act(async () => {
                await undo({ companyId, confirm: true, kinds: [...kinds] });
                setKinds(new Set());
                setSure(false);
              })
            }
          >
            <RotateCcw aria-hidden />
            Undo the chosen records
          </Button>
        </div>
      ) : !preview.canUndo && entries.length ? (
        <Note>Only your company&apos;s Owner can undo imported records.</Note>
      ) : null}
    </Section>
  );
}
