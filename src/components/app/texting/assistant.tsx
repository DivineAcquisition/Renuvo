"use client";

/**
 * Selestial's side of the setup: what it actually did or checked (from the saved notes, never invented),
 * what this step still needs, and a live preview of what people will see. Nothing here is a promise.
 */
import { ACTIVITIES_BY_KEY } from "./catalog";
import { formatPhone, placeName, useSetup } from "./context";
import { Bubble, Needs } from "./parts";

const when = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Assistant() {
  const { view, step } = useSetup();
  const name = view.setup.business.displayName || view.company.name;
  const notes = view.setup.notes.filter((note) => note.step === step).slice(-6).reverse();
  const issues = step === "business" ? view.issues.business.map((row) => row.words) : step === "activities" ? view.issues.activities : step === "permission" ? view.issues.permission : step === "number" ? view.issues.number : [];

  return (
    <div className="grid gap-5 text-sm">
      {step !== "review" && step !== "progress" ? (
        <section className="grid gap-2" aria-label="Checks">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this step</h3>
          <Needs items={issues} />
        </section>
      ) : null}

      <section className="grid gap-2" aria-label={step === "review" ? "What it costs" : step === "progress" ? "What happens next" : "Preview"}>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{step === "review" ? "What it costs" : step === "progress" ? "What happens next" : "Preview"}</h3>
        <Preview name={name} />
      </section>

      {notes.length ? (
        <section className="grid gap-2" aria-label="What Selestial did">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What I did</h3>
          <ul className="grid gap-2">
            {notes.map((note) => (
              <li key={note.key} className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-strong">
                {note.words}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{when(note.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Preview({ name }: { name: string }) {
  const { view, step } = useSetup();
  const from = view.setup.number ? formatPhone(view.setup.number.phoneNumber) : "Your number";
  if (step === "business") {
    return (
      <div className="grid gap-2">
        <Bubble from={from}>{`${name}: you're confirmed for Tue at 10 AM. Reply STOP to opt out.`}</Bubble>
        <p className="text-xs text-muted-foreground">Every text starts with the name customers know you by. Carriers check it matches your registration.</p>
      </div>
    );
  }
  if (step === "activities") {
    const chosen = view.samples.slice(0, 3);
    if (!chosen.length) return <p className="text-xs text-muted-foreground">Choose what you&apos;ll send to see sample texts.</p>;
    return (
      <div className="grid gap-3">
        {chosen.map((sample) => (
          <Bubble key={sample.key} from={`${from} · ${ACTIVITIES_BY_KEY[sample.key]?.label ?? ""}`}>
            {sample.text}
          </Bubble>
        ))}
      </div>
    );
  }
  if (step === "permission") {
    const consent = view.setup.drafts.sms_consent?.text ?? "";
    const marketing = view.setup.drafts.marketing_consent?.text ?? "";
    return (
      <div className="grid gap-2 rounded-xl border border-border bg-background p-3 text-xs" aria-label="Sign-up form preview">
        <p className="font-semibold text-strong">Texts from {name}</p>
        <div className="h-7 rounded-md border border-border bg-card" aria-hidden />
        <div className="h-7 rounded-md border border-border bg-card" aria-hidden />
        <label className="flex items-start gap-2">
          <input type="checkbox" disabled className="mt-0.5" aria-label="Text messages (optional), unchecked" />
          <span>
            <span className="font-medium text-strong">Text messages (optional). </span>
            {consent}
          </span>
        </label>
        {marketing ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" disabled className="mt-0.5" aria-label="Offers by text (optional), unchecked" />
            <span>
              <span className="font-medium text-strong">Offers by text (optional). </span>
              {marketing}
            </span>
          </label>
        ) : null}
        <p className="text-muted-foreground">Both boxes start unchecked.</p>
      </div>
    );
  }
  if (step === "number") {
    const number = view.setup.number;
    return number ? (
      <div className="rounded-xl border border-border p-3">
        <p className="text-lg font-semibold tracking-tight text-strong tabular-nums">{formatPhone(number.phoneNumber)}</p>
        <p className="text-xs text-muted-foreground">{[placeName(number.locality), number.region].filter(Boolean).join(", ")}</p>
        <p className="mt-1 text-xs text-muted-foreground">Not held yet. Checked again right before it&apos;s bought.</p>
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">Search an area code and choose a number.</p>
    );
  }
  if (step === "review") {
    return (
      <div className="grid gap-1.5 text-xs">
        {view.charges.rows.map((row) => (
          <p key={row.key} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium text-strong">{row.amount}</span>
          </p>
        ))}
      </div>
    );
  }
  const request = view.request;
  const current = request?.milestones.find((row) => row.state !== "done");
  return request ? <p className="text-xs text-strong">{current ? current.next : "Texting is ready."}</p> : <p className="text-xs text-muted-foreground">Nothing has been submitted yet.</p>;
}
