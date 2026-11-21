"use client";

/**
 * Every selection control in one place, in each state, for staff to check the system by eye in light and
 * dark, at phone and desktop widths. The records are made up and nothing here saves or sends anything.
 */
import { useState } from "react";

import { Field } from "@/components/app/form";
import { BriefcaseBusiness as Briefcase, Globe, Home } from "@/components/icons";
import {
  Checkbox,
  CheckboxRow,
  ChoiceChips,
  Consequence,
  FieldSource,
  FieldSuggestion,
  MultiSelect,
  RadioGroup,
  Requirement,
  SearchableSelect,
  SegmentedControl,
  Select,
  SelectionCards,
  SwitchRow,
  tableSelection,
  useSuggestion,
  type Option,
} from "@/components/ui/selection";

const CUSTOMERS: Option[] = [
  { value: "c1", label: "Ana Ortiz", meta: "Ortiz Dental · ana@example.com", keywords: ["ortiz dental"] },
  { value: "c2", label: "Ben Carter", meta: "(512) 555-0142" },
  { value: "c3", label: "Ben Carter", meta: "Carter & Sons Property Management, a name long enough to wrap onto a second line" },
  { value: "c4", label: "Élan Apartments", meta: "Leasing office", keywords: ["elan"] },
  { value: "c5", label: "Harbor Clinic", meta: "Paused account", disabled: true, disabledReason: "This customer's account is paused." },
];

const CATEGORIES: Option[] = [
  { value: "residential", label: "Homes", description: "Standard, deep and move-in or move-out cleans", icon: <Home className="size-5" /> },
  { value: "commercial", label: "Offices and businesses", description: "Recurring cleans for workplaces", icon: <Briefcase className="size-5" /> },
];

const ROWS = Array.from({ length: 5 }, (_, at) => `Visit ${at + 1}`);

export function SelectionPreview() {
  const [exchange, setExchange] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>("c9");
  const [many, setMany] = useState<string[]>(["c1", "c2", "c4", "gone"]);
  const [ack, setAck] = useState(false);
  const [pref, setPref] = useState(true);
  const [cats, setCats] = useState<string[]>(["residential"]);
  const [method, setMethod] = useState<string | null>(null);
  const [plan, setPlan] = useState<"" | "weekly" | "biweekly" | "monthly">("");
  const [broadcast, setBroadcast] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [area, setArea] = useState("Austin");
  const [inputs, setInputs] = useState("v1");
  const [picked, setPicked] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const suggestion = useSuggestion({ current: area, proposed: "Austin, Round Rock, Cedar Park", basedOn: "v1", inputs, set: setArea });
  const table = tableSelection({ pageSize: ROWS.length, selectedOnPage: picked.length, matching: 48, allMatching, onSelectPage: () => setPicked(ROWS), onSelectAllMatching: () => setAllMatching(true), onClear: () => {
      setPicked([]);
      setAllMatching(false);
    }, noun: "visits" });

  return (
    <main className="mx-auto grid max-w-3xl gap-8 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-strong">Selection system</h1>
        <p className="text-sm text-muted-foreground">Made-up records. Nothing on this page saves. Check it in light and dark, and at a phone width.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Exchange" hint="A short list: Select.">
          <Select value={exchange} onValueChange={setExchange} options={["NASDAQ", "NYSE", "AMEX"].map((code) => ({ value: code, label: code }))} emptyLabel="None" />
        </Field>
        <Field label="With an error" error="Choose an exchange.">
          <Select value={null} onValueChange={() => undefined} options={[{ value: "a", label: "A" }]} />
        </Field>
        <Field label="Loading">
          <Select value={null} onValueChange={() => undefined} options={[]} loading />
        </Field>
        <Field label="Disabled, compact">
          <Select value="a" onValueChange={() => undefined} options={[{ value: "a", label: "Ask me first" }]} disabled density="compact" />
        </Field>
      </section>

      <section className="grid gap-4">
        <Field label="Customer" hint="A long list: SearchableSelect. The saved choice here can no longer be found.">
          <SearchableSelect value={customer} onValueChange={setCustomer} options={CUSTOMERS} />
        </Field>
        <Field label="Customers to notify" hint="MultiSelect with an earlier choice that can't be found, and a limit of 5.">
          <MultiSelect value={many} onValueChange={setMany} options={CUSTOMERS} max={5} visibleChips={3} />
        </Field>
      </section>

      <section className="grid gap-3">
        <CheckboxRow checked={ack} onCheckedChange={setAck} title="I have read the texting terms" description="Required. It starts unticked." required />
        <CheckboxRow checked={pref} onCheckedChange={setPref} title="Email me a weekly summary" density="compact" aside={<a href="#why" className="text-muted-foreground underline">What&apos;s in it?</a>} />
        <ChoiceChips aria-label="Tools" options={["Spreadsheets", "Paper", "A shared calendar"].map((label) => ({ value: label, label }))} value={tools} onValueChange={setTools} />
      </section>

      <section className="grid gap-3">
        <SelectionCards type="multiple" aria-label="Who do you clean for?" value={cats} onValueChange={setCats} options={CATEGORIES} />
        <SelectionCards type="single" aria-label="Pricing method" value={method} onValueChange={setMethod} columns={3} options={[{ value: "flat", label: "Flat price" }, { value: "hourly", label: "By the hour" }, { value: "sqft", label: "By size", disabled: true, disabledReason: "Needs square footage on properties." }]} />
        <Field label="Visit frequency">
          <RadioGroup value={plan || null} onValueChange={setPlan} options={[{ value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Every two weeks" }, { value: "monthly", label: "Monthly", description: "Fewer visits, longer each." }]} />
        </Field>
        <SegmentedControl label="Frequency, segmented" value={plan} options={[{ id: "weekly", label: "Weekly" }, { id: "biweekly", label: "Biweekly" }, { id: "monthly", label: "Monthly" }]} onChange={setPlan} />
      </section>

      <section className="grid gap-3">
        <SwitchRow title="Ask several cleaners at once" checked={broadcast} onChange={setBroadcast} effect="on-save" dirty={broadcast} consequence={broadcast ? "Dispatch offers each job to up to 3 cleaners together. The first to accept gets it." : "Dispatch asks one cleaner at a time."} requirement={<Requirement>Needs an approved business texting number.</Requirement>} />
        <Consequence>A consequence on its own, for a choice that isn&apos;t a switch.</Consequence>
      </section>

      <section className="grid gap-2">
        <Field label="Areas you serve" aside={<FieldSource source={{ kind: "onboarding" }} onConfirm={() => undefined} />}>
          <input className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={area} onChange={(event) => setArea(event.target.value)} />
        </Field>
        {suggestion.offer ? <FieldSuggestion value="Austin, Round Rock, Cedar Park" source={{ kind: "agent", agent: "Sales" }} reason="Your last 30 bookings came from these three cities." why="Counted from booking addresses only. Nothing is changed until you apply it and save." onApply={suggestion.apply} onDismiss={suggestion.dismiss} stale={suggestion.stale} /> : null}
        <button type="button" className="justify-self-start text-xs text-muted-foreground underline" onClick={() => setInputs(inputs === "v1" ? "v2" : "v1")}>
          Toggle stale ({inputs})
        </button>
        <div className="flex flex-wrap gap-3">
          {(["website", "import", "needs-confirmation", "confirmed"] as const).map((kind) => (
            <FieldSource key={kind} source={{ kind, detail: kind === "import" ? "clients.csv" : undefined }} />
          ))}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="size-3.5" aria-hidden /> icons only with words
          </span>
        </div>
      </section>

      <section className="grid gap-2">
        {table.banner}
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="w-8 py-1 text-left">{table.header}</th>
              <th className="py-1 text-left font-medium text-muted-foreground">Visit</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row} className="border-t border-border">
                <td className="py-1.5">
                  <Checkbox checked={allMatching || picked.includes(row)} onCheckedChange={(on) => {
                      setAllMatching(false);
                      setPicked(on ? [...picked, row] : picked.filter((item) => item !== row));
                    }} aria-label={`Select ${row}`} />
                </td>
                <td className="py-1.5 text-strong">{row}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
