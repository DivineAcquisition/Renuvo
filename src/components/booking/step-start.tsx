"use client";

/** Location and contact, then the property's size: the first two steps of the reference flow. */
import { CheckCircle, House, MapPin } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { BATHROOM_CHOICES, BEDROOM_CHOICES, bathroomFacts, bookingEmailDisclosure } from "../../../convex/lib/booking/logic";
import { copyOf, sectionOn, useBooking } from "./context";
import { BottomBar, Editable, Field, HomeSizePlan, Notice, Pill, SelectedMark, StepHeading } from "./parts";
import { Checkbox } from "@/components/ui/selection";

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function TrustRow() {
  const { def } = useBooking();
  const trust = def.content.trust;
  if (!trust.length) return null;
  return (
    <Editable id="section:trust" label="trust statements" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-[color:var(--bk-muted-text)]">
      {trust.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1.5">
          <CheckCircle className="h-4 w-4 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
          {t.text}
        </span>
      ))}
    </Editable>
  );
}

export function LocationStep() {
  const { def, view, actions, next, company } = useBooking();
  const copy = copyOf(def, "location").copy;
  const [zip, setZip] = useState(() => view?.postalCode ?? (typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("zip") ?? "").replace(/[^\w -]/g, "").slice(0, 10) : ""));
  const [first, setFirst] = useState(view?.contact?.firstName ?? "");
  const [last, setLast] = useState(view?.contact?.lastName ?? "");
  const [email, setEmail] = useState(view?.contact?.email ?? "");
  const [phone, setPhone] = useState(formatPhone(view?.contact?.phone?.replace(/^\+1/, "") ?? ""));
  // Optional and unchecked: shown only when the company has published its texting wording, which a yes is recorded against.
  const [textOk, setTextOk] = useState(view?.contact?.textOk === true && view?.contact?.textVersion === company.texting?.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingZip, setEditingZip] = useState(!view?.postalCode);
  const [sent, setSent] = useState(false);

  const submitZip = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(zip.trim())) return setError("Enter a valid ZIP code.");
    setBusy(true);
    setError(null);
    const result = view ? await actions.setLocation(zip.trim()) : await actions.start(zip.trim());
    setBusy(false);
    if (!result.ok) setError(result.why);
    else setEditingZip(false);
  };

  const outOfArea = view?.outOfArea === true;
  const contactReady = first.trim() && last.trim() && /.+@.+\..+/.test(email) && phone.replace(/\D/g, "").length === 10;

  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contactReady) return;
    setBusy(true);
    setError(null);
    const saved = await actions.setContact({ firstName: first, lastName: last, email, phone, textOk: textOk && !!company.texting, ...(textOk && company.texting ? { textVersion: company.texting.version } : {}) });
    if (!saved.ok) {
      setBusy(false);
      return setError(saved.why);
    }
    if (outOfArea) {
      const sentResult = def.behavior.outOfArea === "request" ? await actions.sendRequest() : { ok: true as const };
      setBusy(false);
      if (!sentResult.ok) return setError(sentResult.why);
      return setSent(true);
    }
    setBusy(false);
    next();
  };

  const showZipForm = !view || editingZip;
  return (
    <div className="mx-auto max-w-xl px-4 py-8 @3xl:py-14">
      <StepHeading id="copy:location" title={copy.title} subtitle={copy.subtitle} />
      {sectionOn(def, "location", "promo_banner") && def.content.promo.text ? (
        <Editable id="section:promo_banner" label="the offer banner" className="mb-6 rounded-[var(--bk-radius)] border border-[rgb(var(--bk-brand-rgb)/0.3)] bg-[rgb(var(--bk-brand-rgb)/0.08)] p-4 text-center text-sm font-medium text-[color:var(--bk-brand-text)]">
          {def.content.promo.text}
        </Editable>
      ) : null}
      <div className="bk-card space-y-5 p-5 @2xl:p-6">
        {showZipForm ? (
          <form onSubmit={submitZip} className="space-y-4 bk-rise">
            <Field id="bk-zip" label="Your ZIP code" help="We check that we serve your area. It does not change the price." error={error}>
              <input id="bk-zip" className="bk-input h-14 text-center text-lg" inputMode="numeric" autoComplete="postal-code" maxLength={10} placeholder="12345" value={zip} onChange={(e) => setZip(e.target.value.replace(/[^\w -]/g, ""))} />
            </Field>
            <button type="submit" disabled={busy || zip.trim().length < 3} className="bk-btn h-12 w-full text-base @2xl:h-14 @2xl:text-lg">
              {busy ? "Checking…" : copy.button || "Continue"}
            </button>
          </form>
        ) : sent ? (
          <div className="space-y-3 py-4 text-center bk-rise">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[rgb(var(--bk-brand-rgb)/0.1)]">
              <CheckCircle className="h-8 w-8 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
            </div>
            <h2 className="text-xl font-semibold">Thanks, {first}.</h2>
            <p className="text-sm text-[color:var(--bk-muted-text)]">{def.behavior.outOfArea === "request" ? `${company.name} has your details and will reach out if they can help.` : `Please contact ${company.name} directly.`}</p>
          </div>
        ) : (
          <form onSubmit={submitContact} className="space-y-5 bk-rise">
            {outOfArea ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-left">
                <MapPin className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" aria-hidden weight="duotone" />
                <div>
                  <Editable id="content:outOfArea" label="the out-of-area message">
                    <p data-editable-text className="font-semibold text-amber-900">{def.content.outOfAreaTitle}</p>
                    <p data-editable-text className="text-sm text-amber-800">{def.content.outOfAreaBody}</p>
                  </Editable>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg bg-[var(--bk-muted)] p-4 text-left">
                <CheckCircle className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
                <div>
                  <p className="font-semibold">Good news — we serve {view?.postalCode}.</p>
                  <p className="text-sm text-[color:var(--bk-muted-text)]">Enter your details and we&apos;ll show the price for your property.</p>
                </div>
              </div>
            )}
            {outOfArea && def.behavior.outOfArea === "contact_only" ? (
              <p className="text-sm text-[color:var(--bk-muted-text)]">{company.phone ? `Call ${company.phone}` : company.email ? `Email ${company.email}` : `Contact ${company.name}`} to ask about service in your area.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field id="bk-first" label="First name" required>
                    <input id="bk-first" className="bk-input" autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} />
                  </Field>
                  <Field id="bk-last" label="Last name" required>
                    <input id="bk-last" className="bk-input" autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} />
                  </Field>
                </div>
                <Field id="bk-email" label="Email" required>
                  <input id="bk-email" type="email" className="bk-input" autoComplete="email" aria-describedby="bk-email-note" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <p id="bk-email-note" className="mt-1.5 text-xs text-[color:var(--bk-muted-text)]">{bookingEmailDisclosure(company.name)}</p>
                </Field>
                <Field id="bk-phone" label="Phone number" required error={error}>
                  <input id="bk-phone" type="tel" className="bk-input" autoComplete="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} />
                </Field>
                {company.texting ? (
                  <label className="flex items-start gap-3 rounded-[var(--bk-radius)] border border-[color:var(--bk-hairline)] p-3 text-left text-xs leading-5 text-[color:var(--bk-muted-text)]">
                    <Checkbox checked={textOk} onCheckedChange={(checked) => setTextOk(checked)} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium text-[color:var(--bk-text,inherit)]">Text messages (optional)</span>
                      {company.texting.consent}{" "}
                      <a href={company.texting.terms} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        Texting Terms
                      </a>{" "}
                      ·{" "}
                      <a href={company.texting.privacy} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        Privacy Policy
                      </a>
                    </span>
                  </label>
                ) : null}
                <button type="submit" disabled={!contactReady || busy} className="bk-btn h-12 w-full text-base @2xl:h-14 @2xl:text-lg">
                  {busy ? "Saving…" : outOfArea ? "Send my details" : "See my price"}
                </button>
              </>
            )}
            <button type="button" onClick={() => setEditingZip(true)} className="text-sm font-medium text-[color:var(--bk-brand-text)] underline underline-offset-2">
              ← Change ZIP code ({view?.postalCode})
            </button>
          </form>
        )}
      </div>
      {sectionOn(def, "location", "trust") ? <TrustRow /> : null}
    </div>
  );
}

export function SizeStep() {
  const { def, view, actions, next, back } = useBooking();
  const copy = copyOf(def, "size").copy;
  const plan = view?.size;
  const home = view?.home ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState(home.area && !home.sizeKey ? String(home.area) : "");
  const [bedrooms, setBedrooms] = useState<number | undefined>(home.bedrooms);
  const [baths, setBaths] = useState<number | undefined>(home.bathrooms !== undefined ? home.bathrooms + (home.halfBaths ? 0.5 : 0) : undefined);
  const [beds, setBeds] = useState(home.beds !== undefined ? String(home.beds) : "");

  if (!plan) return null;
  const cards = plan.area?.kind === "cards" ? plan.area : null;

  const save = async (facts: Parameters<typeof actions.setHome>[0], advance: boolean) => {
    setBusy(true);
    setError(null);
    const result = await actions.setHome(facts);
    setBusy(false);
    if (!result.ok) return setError(result.why);
    if (advance) next();
  };

  const roomsReady = !plan.rooms || (bedrooms !== undefined && baths !== undefined);
  const areaReady = !plan.area || (cards ? Boolean(home.sizeKey) : Number(area) > 0);
  const bedsReady = !plan.beds || Number(beds) > 0;
  const ready = roomsReady && areaReady && bedsReady;
  const pickCard = async (key: string) => {
    // A card alone answers everything: go straight on, as the reference does.
    await save({ sizeKey: key }, !plan.rooms && !plan.beds);
  };
  const finish = async () => {
    const facts: Parameters<typeof actions.setHome>[0] = {};
    if (plan.area?.kind === "input") facts.area = Number(area);
    if (plan.rooms && bedrooms !== undefined && baths !== undefined) Object.assign(facts, { bedrooms }, bathroomFacts(baths));
    if (plan.beds) facts.beds = Number(beds);
    await save(facts, true);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 @3xl:px-6 @3xl:py-12">
      <StepHeading id="copy:size" title={copy.title} subtitle={copy.subtitle} icon={<House className="h-7 w-7 @3xl:h-8 @3xl:w-8" aria-hidden weight="duotone" />} />
      {cards ? (
        <Editable id="sizes" label="size labels">
          <div role="radiogroup" aria-label="Property size" className="mb-6 grid grid-cols-1 gap-3 @3xl:grid-cols-3 @3xl:gap-5">
            {cards.cards.map((card, index) => {
              const selected = home.sizeKey === card.key;
              return (
                <button key={card.key} type="button" role="radio" aria-checked={selected} data-selected={selected} disabled={busy} onClick={() => void pickCard(card.key)} className="bk-select-card p-4 text-center @3xl:p-5">
                  {selected ? <SelectedMark /> : null}
                  {def.theme.showIllustrations ? <HomeSizePlan index={index} total={cards.cards.length} selected={selected} /> : null}
                  <span className="mb-1 block text-lg font-bold @3xl:text-xl">{card.label}</span>
                  {card.sublabel ? <span className="block text-sm text-[color:var(--bk-brand-text)]">{card.sublabel}</span> : null}
                </button>
              );
            })}
          </div>
          {cards.customQuoteFrom !== null ? (
            <div className="bk-card mb-6 bg-[var(--bk-muted)] p-5 text-center @3xl:p-6">
              <p className="mb-3 text-base font-medium text-[color:var(--bk-brand-text)] @3xl:text-lg">{def.sizes.customQuoteTitle}</p>
              <button type="button" disabled={busy} onClick={() => void save({ sizeKey: `area-${cards.customQuoteFrom}-custom` }, true)} className="inline-flex h-10 items-center gap-2 rounded-[calc(var(--bk-radius)*0.75)] bg-[var(--bk-ink)] px-5 text-sm font-semibold text-white hover:opacity-90">
                {def.sizes.customQuoteButton}
              </button>
            </div>
          ) : null}
        </Editable>
      ) : null}
      {plan.area?.kind === "input" ? (
        <div className="bk-card mx-auto mb-6 max-w-md p-5">
          <Field id="bk-area" label={`Size (${plan.area.unit === "sq_ft" ? "square feet" : "square meters"})`} required help="An estimate is fine. The team confirms on the day.">
            <input id="bk-area" className="bk-input text-center text-lg" inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          </Field>
        </div>
      ) : null}
      {plan.rooms ? (
        <div className="bk-card mx-auto mb-6 max-w-xl space-y-5 p-5 @2xl:p-6">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Bedrooms</legend>
            <div className="grid grid-cols-6 gap-2">
              {BEDROOM_CHOICES.map((n) => (
                <button key={n} type="button" aria-pressed={bedrooms === n} onClick={() => setBedrooms(n)} className={cn("h-11 rounded-lg border text-sm font-semibold", bedrooms === n ? "border-[var(--bk-brand)] bg-[var(--bk-brand)] text-[color:var(--bk-on-brand)]" : "border-[color:var(--bk-hairline)] bg-white hover:border-[rgb(var(--bk-brand-rgb)/0.5)]")}>
                  {n === 6 ? "6+" : n}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Bathrooms</legend>
            <div className="grid grid-cols-4 gap-2 @2xl:grid-cols-8">
              {BATHROOM_CHOICES.map((n) => (
                <button key={n} type="button" aria-pressed={baths === n} onClick={() => setBaths(n)} className={cn("h-11 rounded-lg border text-sm font-semibold", baths === n ? "border-[var(--bk-brand)] bg-[var(--bk-brand)] text-[color:var(--bk-on-brand)]" : "border-[color:var(--bk-hairline)] bg-white hover:border-[rgb(var(--bk-brand-rgb)/0.5)]")}>
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      {plan.beds ? (
        <div className="bk-card mx-auto mb-6 max-w-md p-5">
          <Field id="bk-beds" label="Beds to make" required>
            <input id="bk-beds" className="bk-input text-center text-lg" inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </Field>
        </div>
      ) : null}
      {error ? <Notice tone="bad" title={error} /> : null}
      {plan.area?.kind === "input" || plan.rooms || plan.beds ? (
        <div className="hidden justify-center @3xl:flex">
          <button type="button" disabled={!ready || busy} onClick={() => void finish()} className="bk-btn h-12 min-w-[220px] px-8 text-base">
            {busy ? "Saving…" : copy.button || "Continue"}
          </button>
        </div>
      ) : null}
      <BottomBar onBack={back ?? undefined} onContinue={plan.area?.kind === "input" || plan.rooms || plan.beds ? () => void finish() : home.sizeKey ? next : undefined} continueLabel={copy.button || "Continue"} disabled={!ready} busy={busy} />
      {view && view.requestWords && home.area ? (
        <div className="mx-auto mt-4 max-w-xl">
          <Pill tone="muted">{view.requestWords}</Pill>
        </div>
      ) : null}
    </div>
  );
}
