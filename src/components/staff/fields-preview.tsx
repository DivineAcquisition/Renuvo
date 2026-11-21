"use client";

/**
 * Every shared form field in one place, in each state, for staff to check by eye in light and dark and at
 * phone and desktop widths. The values are made up and nothing here saves or sends anything.
 */
import { useState } from "react";

import { Field } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import {
  AssistedTextArea,
  AvailabilityStatus,
  ContactStatus,
  CountField,
  Disclosure,
  DurationField,
  EmailInput,
  FileDetails,
  fromChecklist,
  ListInput,
  MoneyField,
  organizeIntoSteps,
  PercentField,
  PhoneInput,
  ScheduleSummary,
  TimezoneNote,
  useConfirm,
  zipProblem,
  type WritingAction,
} from "@/components/ui/fields";
import { Consequence, FieldSource, FieldSuggestion } from "@/components/ui/selection";

const TZ = "America/Chicago";
const FRIDAY_NINE = Date.UTC(2027, 2, 5, 15, 0);

export function FieldsPreview() {
  const [skills, setSkills] = useState<string[]>(["Deep clean", "Move-out"]);
  const [zips, setZips] = useState<string[]>(["02134", "78701"]);
  const [price, setPrice] = useState("145.00");
  const [blank, setBlank] = useState("");
  const [percent, setPercent] = useState("8.25");
  const [minutes, setMinutes] = useState("150");
  const [crew, setCrew] = useState("2");
  const [text, setText] = useState("Dust every surface. Vacuum and mop the floors. Wipe the kitchen counters for $0 extra.");
  const [phone, setPhone] = useState("5125550100");
  const [email, setEmail] = useState("dana@example");
  const { ask, element } = useConfirm();
  const writing: WritingAction[] = [
    { id: "steps", label: "Organize into steps", kind: "template", run: organizeIntoSteps },
    { id: "checklist", label: "Use service checklist", kind: "template", run: () => fromChecklist(["Dust every surface", "Vacuum and mop floors", "Clean kitchen counters and sink", "Empty bins"]) },
    { id: "slow", label: "Prepare slowly (demo)", kind: "template", run: (current) => new Promise((done) => setTimeout(() => done(current.toUpperCase()), 1500)) },
  ];

  return (
    <main className="mx-auto grid max-w-3xl gap-8 p-6">
      {element}
      <header>
        <h1 className="font-display text-2xl font-semibold text-strong">Form fields</h1>
        <p className="text-sm text-muted-foreground">Made-up values. Nothing on this page saves. Check it in light and dark, and at a phone width.</p>
      </header>

      <section className="grid gap-4">
        <Field label="Confirmed skills" hint="Dispatch uses these skills when matching this cleaner to visits. Adding one records what you confirmed; it is not a check of training.">
          <ListInput value={skills} onChange={setSkills} suggestions={[{ value: "Deep clean", detail: "From your services" }, { value: "Move-out", detail: "From your services" }, { value: "Post-construction", detail: "From your services" }, { value: "Window cleaning", detail: "From your services" }]} noun="skill" />
        </Field>
        <Field label="Service areas" hint="Try 2134, a duplicate, or pasting 78702, 78703.">
          <ListInput value={zips} onChange={setZips} validate={zipProblem} noun="ZIP code" placeholder="Type a ZIP code and press Enter" />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Price">
          <MoneyField value={price} onChange={setPrice} />
        </Field>
        <Field label="Price (blank means not set)" hint="Blank stays blank; it is never turned into $0.">
          <MoneyField value={blank} onChange={setBlank} placeholder="Not set" />
        </Field>
        <Field label="Sales tax rate">
          <PercentField value={percent} onChange={setPercent} precision={3} />
        </Field>
        <Field label="Visit length">
          <DurationField value={minutes} onChange={setMinutes} min={30} max={720} step={15} stepper />
        </Field>
        <Field label="Cleaners needed" error={crew === "0" ? "A visit needs at least one cleaner." : null}>
          <CountField value={crew} onChange={setCrew} noun={["cleaner", "cleaners"]} min={1} max={20} />
        </Field>
        <Field label="Disabled">
          <MoneyField value="80.00" onChange={() => undefined} disabled />
        </Field>
      </section>
      {Number(crew) > 1 ? <Consequence>1 more accepted cleaner is needed before the visit is staffed.</Consequence> : null}

      <section className="grid gap-3">
        <ScheduleSummary startsAt={FRIDAY_NINE} endsAt={FRIDAY_NINE + Number(minutes || 0) * 60000} timezone={TZ} arrivalWindowMinutes={30} />
        <ScheduleSummary startsAt={Date.UTC(2027, 2, 6, 3, 0)} endsAt={Date.UTC(2027, 2, 6, 7, 0)} timezone={TZ} label="Overnight example" />
        <ScheduleSummary startsAt={Date.UTC(2027, 2, 14, 7, 0)} endsAt={Date.UTC(2027, 2, 14, 10, 0)} timezone={TZ} label="Clock-change example" />
        <ScheduleSummary startsAt={FRIDAY_NINE} endsAt={FRIDAY_NINE - 60000} timezone={TZ} />
        <TimezoneNote timezone={TZ} />
        <AvailabilityStatus timezone={TZ} status={{ state: "not_checked" }} />
        <AvailabilityStatus timezone={TZ} status={{ state: "checking" }} />
        <AvailabilityStatus timezone={TZ} status={{ state: "available", checkedAt: FRIDAY_NINE - 3600000 }} />
        <AvailabilityStatus timezone={TZ} status={{ state: "conflict", reasons: ["Ana is booked on another visit until 10:00 AM."] }} />
        <AvailabilityStatus timezone={TZ} status={{ state: "failed" }} />
      </section>

      <section className="grid gap-2">
        <Field label="Instructions for the crew" hint="Try a writing action, then type while “Prepare slowly” runs.">
          <AssistedTextArea value={text} onChange={setText} actions={writing} maxLength={600} audience={{ label: "Visible to the assigned cleaner after they accept." }} />
        </Field>
        <Field label="Office note">
          <AssistedTextArea value="" onChange={() => undefined} audience={{ label: "Internal note: visible to your office team.", internal: true }} />
        </Field>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Field label="Mobile phone">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <Field label="Email" hint="Leave the field to see the check.">
          <EmailInput value={email} onChange={setEmail} />
        </Field>
        <div className="sm:col-span-2">
          <ContactStatus kind="phone" wellFormed verified={false} consent="unknown" />
        </div>
      </section>

      <section className="grid gap-2">
        <FieldSource source={{ kind: "onboarding" }} />
        <FieldSource source={{ kind: "confirmed" }} />
        <FieldSuggestion value="Ask 3 cleaners at once" source={{ kind: "agent", agent: "Dispatch" }} reason="Based on your saved replacement policy." onApply={() => undefined} onDismiss={() => undefined} />
      </section>

      <section className="grid gap-3">
        <Disclosure title="The original, as it was given" summary="42 lines, kept for review.">
          <pre className="text-xs whitespace-pre-wrap">Standard clean,145,per visit{"\n"}Deep clean,260,per visit</pre>
        </Disclosure>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">A plain disclosure elsewhere in the app</summary>
          <p className="mt-2 text-muted-foreground">Every disclosure gets the same chevron and focus ring.</p>
        </details>
        <FileDetails name="clients-export-from-jobber.csv" type="text/csv" size={48213} state="ready" counts={[{ label: "Rows", value: 212 }, { label: "Looks like", value: "a Jobber export" }]} onReplace={() => undefined} />
        <FileDetails name="pricing.csv" size={1200} state="checking" />
        <FileDetails name="photo.heic" size={3_400_000} state="failed" error="That isn't a spreadsheet. Save it as CSV and choose it again." onRetry={() => undefined} onRemove={() => undefined} />
      </section>

      <section>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void ask({
              title: "Set the remaining import aside?",
              body: "Service drafts already created will remain. The remaining rows will not be imported.",
              details: [{ label: "Import", value: "pricing.csv" }, { label: "Waiting", value: "4 rows" }],
              confirmLabel: "Set remaining rows aside",
              cancelLabel: "Continue reviewing",
              action: () => new Promise((_, fail) => setTimeout(() => fail(new Error("demo")), 900)),
            })
          }
        >
          Open a confirmation (it fails, to show the error)
        </Button>
      </section>
    </main>
  );
}
