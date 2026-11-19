"use client";

/**
 * Step 4: the company's own local number. Search an area code; each number shows where it is, what it can
 * actually do (as Telnyx reports it) and what it costs each month. Choosing one holds nothing: it is
 * checked again right before it's bought, and never swapped for another without asking.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Field, TextInput } from "@/components/app/form";
import { Check, Phone, Search } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatPhone, useSetup } from "./context";
import { Note, Section, StepHeading } from "./parts";

export function NumberStep() {
  const { view, companyId, run, locked } = useSetup();
  const startSearch = useMutation(api.texting.searchNumbersFor);
  const choose = useMutation(api.textingSetup.chooseNumber);
  const [areaCode, setAreaCode] = useState(() => (view.setup.business.supportPhone ?? "").replace(/\D/g, "").replace(/^1/, "").slice(0, 3));
  const [searchId, setSearchId] = useState<Id<"numberSearches"> | null>(view.setup.number?.searchId ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const results = useQuery(api.texting.search, searchId ? { companyId, searchId } : "skip");
  const chosen = view.setup.number;
  const monthly = view.charges.rows.find((row) => row.key === "number")?.amount ?? "";
  const needsNumber = view.request?.needs?.kind === "number";

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      setSearchId(await startSearch({ companyId, areaCode }));
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message.replace(/^.*Uncaught \w+Error: /, "") : "The search didn't start.");
    }
  }

  return (
    <>
      <StepHeading eyebrow="Step 4 of 6" title="Your number" lead="A dedicated local number for your business. Customers, cleaners and applicants see it on every text." />
      {needsNumber ? <Note tone="warning">{view.request?.needs?.words}</Note> : null}

      {chosen ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-500 bg-brand-500/5 px-4 py-3">
          <Phone className="size-5 text-brand-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold tracking-tight text-strong tabular-nums">{formatPhone(chosen.phoneNumber)}</p>
            <p className="text-xs text-muted-foreground">{[chosen.locality, chosen.region].filter(Boolean).join(", ") || "United States"} · your choice</p>
          </div>
          <Capabilities sms={chosen.sms} mms={chosen.mms} voice={chosen.voice} />
        </div>
      ) : null}

      <Section title={chosen ? "Choose a different number" : "Find a number"} lead="US local numbers only.">
        <form onSubmit={(event) => void search(event)} className="flex flex-wrap items-end gap-2">
          <Field label="Area code" hint="Three digits, for example 512." className="w-40">
            <TextInput value={areaCode} onChange={(event) => setAreaCode(event.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" autoComplete="off" />
          </Field>
          <Button type="submit" variant="primary" disabled={areaCode.length !== 3 || (locked && !needsNumber)}>
            <Search aria-hidden />
            Search
          </Button>
        </form>
        {problem ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {problem}
          </p>
        ) : null}

        {searchId && results === undefined ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-busy="true" aria-label="Searching">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : results?.status === "pending" ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-busy="true" aria-label="Searching">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : results?.status === "failed" ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            The search didn&apos;t work right now. Try again in a minute.
          </p>
        ) : results ? (
          results.results.length === 0 ? (
            <Note>No numbers can be offered in {results.areaCode} right now. Try a nearby area code; numbers come and go through the day.</Note>
          ) : (
            <div className="grid gap-2">
              {results.nearbyRegion ? <Note>None were available in {results.areaCode}, so these are elsewhere in {results.nearbyRegion}.</Note> : null}
              <ul className="grid gap-2 sm:grid-cols-2" aria-label="Available numbers">
                {results.results.map((row) => {
                  const selected = chosen?.phoneNumber === row.phoneNumber;
                  const features = row.features ?? ["sms"];
                  return (
                    <li key={row.phoneNumber}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        disabled={locked && !needsNumber}
                        onClick={() => void run((revision) => choose({ companyId, revision, searchId: searchId!, phoneNumber: row.phoneNumber }))}
                        className={cn("grid w-full gap-1 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 motion-reduce:transition-none", selected ? "border-brand-500 bg-brand-500/5" : "border-border bg-card hover:border-brand-500/40")}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold text-strong tabular-nums">{formatPhone(row.phoneNumber)}</span>
                          {selected ? <Check className="size-4 text-brand-300" aria-label="Chosen" /> : null}
                        </span>
                        <span className="text-xs text-muted-foreground">{[row.locality, row.region].filter(Boolean).join(", ") || "United States"}</span>
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <Capabilities sms={features.includes("sms")} mms={features.includes("mms")} voice={features.includes("voice")} />
                          <span className="text-xs font-medium text-strong">{monthly}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )
        ) : null}
      </Section>

      <Note>Choosing a number doesn&apos;t hold it. It&apos;s bought only after the carriers approve your registration, and checked again first. If it&apos;s been taken by then, Selestial asks you to choose another instead of picking one for you.</Note>
      <p className="text-xs text-muted-foreground">Toll-free numbers and bringing a number you already have are separate requests, not part of this setup. Write to support if you need either.</p>
    </>
  );
}

function Capabilities({ sms, mms, voice }: { sms: boolean; mms: boolean; voice: boolean }) {
  return (
    <span className="flex flex-wrap gap-1" aria-label="What this number can do">
      {sms ? <Badge variant="outline">Texts</Badge> : null}
      {mms ? <Badge variant="outline">Pictures</Badge> : null}
      {voice ? <Badge variant="outline">Calls</Badge> : null}
    </span>
  );
}
