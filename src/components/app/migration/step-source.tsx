"use client";

/**
 * Step 1: where the business is coming from, and what the owner wants to move. Each card says what works
 * today, plainly, and what doesn't come across. A CSV from a provider is never presented as an integration.
 */
import { useQuery } from "convex/react";

import { Check, Minus, ShieldCheck, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { FILE_KINDS, IMPORTABLE, KIND_LABELS, type FileKind } from "../../../../convex/lib/migration/rules";
import { SOURCE_CARDS, SOURCES, type Source } from "../../../../convex/lib/migration/sources";
import { useMigration } from "./context";
import { StepHeading } from "./parts";

export function SourceStep() {
  const { view, companyId, save, locked } = useMigration();
  const connectors = useQuery(api.connectors.status, { companyId });
  const chosen = view.migration.source;
  const wants = new Set(view.migration.wants);
  const toggle = (kind: FileKind) => {
    const next = new Set(wants);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    void save({ wants: [...next] });
  };
  const connectorOn = (source: Source) => (source === "jobber" ? connectors?.jobber.available : source === "housecall_pro" ? connectors?.housecall.available : false);

  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <StepHeading eyebrow="Step 1 of 6" title="Where is your business today?" lead="Choose the system you're moving from. You can add files from more than one place later." />

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup" aria-label="Your current system">
        {SOURCES.map((id) => {
          const card = SOURCE_CARDS[id];
          const selected = chosen === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked}
              onClick={() => void save({ source: id })}
              className={cn(
                "group grid content-start gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 motion-reduce:transition-none",
                selected ? "border-brand-500 bg-brand-500/[0.06] shadow-[0_0_0_1px_var(--color-brand-500)]" : "border-border bg-card hover:border-brand-500/40 hover:bg-muted/40",
                id === "assisted" && !selected ? "bg-gradient-to-br from-brand-500/[0.06] to-transparent" : "",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-strong">
                  {id === "assisted" ? <Sparkles className="size-4 text-brand-300" aria-hidden /> : <SourceMark id={id} />}
                  {card.name}
                </span>
                {selected ? (
                  <span className="grid size-5 place-items-center rounded-full bg-brand-500 text-white" aria-hidden>
                    <Check className="size-3" />
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{card.summary}</span>
              <ul className="grid gap-1 text-xs">
                {card.supported.filter((line) => !/connection/i.test(line) || connectorOn(id)).map((line) => (
                  <li key={line} className="flex gap-1.5 text-strong">
                    <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden />
                    {line}
                  </li>
                ))}
                {card.notSupported.slice(0, 2).map((line) => (
                  <li key={line} className="flex gap-1.5 text-muted-foreground">
                    <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
              <span className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{id === "assisted" ? "With our team" : "CSV upload"}</Badge>
                {connectorOn(id) ? <Badge variant="info">Read-only connection available</Badge> : null}
                {card.verifiedFrom ? (
                  <Badge variant="success">
                    <ShieldCheck className="size-3" aria-hidden />
                    Export steps checked
                  </Badge>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {chosen ? <Chosen source={chosen} /> : null}

      <section className="grid gap-3 border-t border-border pt-6">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold text-strong">What do you want to bring?</h3>
          <p className="text-xs text-muted-foreground">Selestial imports customers, properties, recurring services and upcoming bookings now. Other files are kept with your migration and listed as not transferred, so nothing is silently left out.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Records to bring">
          {FILE_KINDS.filter((k) => k !== "other").map((kind) => {
            const on = wants.has(kind);
            const now = (IMPORTABLE as readonly string[]).includes(kind);
            return (
              <button key={kind} type="button" aria-pressed={on} disabled={locked} onClick={() => toggle(kind)} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", on ? "border-brand-500 bg-brand-500/10 text-strong" : "border-border text-muted-foreground hover:bg-muted")}>
                {on ? <Check className="size-3" aria-hidden /> : null}
                {KIND_LABELS[kind].label}
                {!now ? <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-strong">Coming next</span> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Chosen({ source }: { source: Source }) {
  const card = SOURCE_CARDS[source];
  if (source === "assisted") {
    return (
      <div className="grid gap-2 rounded-2xl border border-brand-500/30 bg-brand-500/[0.04] p-4 text-sm">
        <p className="font-semibold text-strong">How assisted migration works</p>
        <ol className="grid list-decimal gap-1 pl-5 text-xs text-muted-foreground">
          <li>Upload whatever you have in the next step: exports, spreadsheets, even partial lists.</li>
          <li>Your Selestial contact works with you in this same migration: reviewing files, proposing mappings and fixes. Each change shows who made it.</li>
          <li>You review everything and approve the import. Our team can&apos;t approve messages to your customers or any spending for you.</li>
        </ol>
        <p className="text-xs text-muted-foreground">Selestial&apos;s AI review is included at no charge for assisted migrations.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-muted/30 p-4">
      <p className="text-sm font-semibold text-strong">Getting your files out of {card.name}</p>
      {card.exportSteps.map((group) => (
        <div key={group.title} className="grid gap-1">
          <p className="text-xs font-medium text-strong">{group.title}</p>
          <ol className="grid list-decimal gap-0.5 pl-5 text-xs text-muted-foreground">
            {group.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        {card.verifiedFrom ? (
          <>
            Checked against{" "}
            <a className="text-brand-300 underline underline-offset-2" href={card.verifiedFrom.url} target="_blank" rel="noreferrer">
              {card.name}&apos;s help center
            </a>{" "}
            on {new Date(`${card.verifiedFrom.checkedOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Menus can change; tell us if these steps don&apos;t match.
          </>
        ) : source === "jobber" || source === "bookingkoala" ? (
          `Selestial hasn't confirmed ${card.name}'s exact menu names. If the export option is somewhere else, ${card.name}'s support can point you to it.`
        ) : (
          "Any CSV with a header row works. Selestial shows you what it found before anything is imported."
        )}
      </p>
      {card.notSupported.length > 2 ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {card.notSupported.slice(2).map((line) => (
            <li key={line} className="flex gap-1.5">
              <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SourceMark({ id }: { id: Source }) {
  const letters: Record<Source, string> = { jobber: "J", housecall_pro: "HP", bookingkoala: "BK", spreadsheet: "CSV", other: "…", assisted: "S" };
  return <span className="grid h-6 min-w-6 place-items-center rounded-md bg-muted px-1 text-[10px] font-bold text-strong" aria-hidden>{letters[id]}</span>;
}
