"use client";

/**
 * A booking form as a person fills it in. The builder's preview and the public page both render this
 * one component from the same definition, so what the owner sees in the preview is what a customer gets.
 *
 * It says which it is, a request for an estimate or a request for a time, and that neither is a
 * confirmed booking. Permission to text is its own unticked box with the company's exact words.
 */
import type { FunctionReturnType } from "convex/server";
import { useId } from "react";

import { cn } from "@/lib/utils";

import type { api } from "../../../convex/_generated/api";

type OpenView = Extract<NonNullable<FunctionReturnType<typeof api.salesFormPages.view>>, { open: true }>;
export type FormDefinition = OpenView["form"];
export type FormField = FormDefinition["fields"][number];
export type FormService = { key: string; name: string; summary?: string };
export type Answers = Record<string, string | number | boolean>;
export type FormValues = { name: string; email: string; phone: string; serviceKey: string; answers: Answers; smsConsent: boolean; website: string };
export const EMPTY_VALUES: FormValues = { name: "", email: "", phone: "", serviceKey: "", answers: {}, smsConsent: false, website: "" };

/** A question that depends on an earlier answer is shown only when that answer matches. The server applies the same rule. */
export function isShown(field: FormField, answers: Answers): boolean {
  if (!field.showIf) return true;
  const parent = answers[field.showIf.fieldId];
  const value = typeof parent === "boolean" ? (parent ? "Yes" : "No") : String(parent ?? "");
  return value.toLowerCase() === field.showIf.equals.toLowerCase();
}

const control =
  "block w-full min-h-12 rounded-xl border border-border bg-card px-3.5 py-2.5 text-base text-strong placeholder:text-muted-foreground/70 focus-visible:border-[var(--form-accent)] focus-visible:outline-2 focus-visible:outline-[color-mix(in_oklab,var(--form-accent)_35%,transparent)] aria-invalid:border-destructive/60 disabled:opacity-60";

function Labelled({ label, required, help, error, children, id }: { label: string; required?: boolean; help?: string; error?: string; children: React.ReactNode; id: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-strong">
        {label}
        {required ? (
          <span className="text-destructive-foreground" aria-hidden>
            {" "}
            *
          </span>
        ) : (
          <span className="font-normal text-muted-foreground"> (optional)</span>
        )}
      </label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Question({ field, value, onChange, error, disabled }: { field: FormField; value: string | number | boolean | undefined; onChange: (value: string | boolean) => void; error?: string; disabled?: boolean }) {
  const id = useId();
  const described = [field.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const shared = { id, disabled, "aria-describedby": described, "aria-invalid": error ? true : undefined, required: field.required };
  const text = typeof value === "boolean" ? "" : String(value ?? "");

  if (field.kind === "yes_no" || (field.kind === "choice" && field.options.length <= 5)) {
    const options = field.kind === "yes_no" ? ["Yes", "No"] : field.options;
    const current = field.kind === "yes_no" ? (value === true || value === "Yes" ? "Yes" : value === false || value === "No" ? "No" : "") : text;
    return (
      <fieldset className="grid gap-1.5" aria-describedby={described}>
        <legend className="mb-1.5 text-sm font-medium text-strong">
          {field.label}
          {field.required ? (
            <span className="text-destructive-foreground" aria-hidden>
              {" "}
              *
            </span>
          ) : (
            <span className="font-normal text-muted-foreground"> (optional)</span>
          )}
        </legend>
        <div className={cn("grid gap-2", options.length <= 2 ? "grid-cols-2" : "sm:grid-cols-2")}>
          {options.map((option) => (
            <label key={option} className={cn("flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-base has-focus-visible:outline-2 has-focus-visible:outline-[var(--form-accent)]", current === option ? "border-[var(--form-accent)] bg-[color-mix(in_oklab,var(--form-accent)_8%,transparent)] text-strong" : "border-border bg-card text-strong")}>
              <input type="radio" name={id} value={option} checked={current === option} disabled={disabled} onChange={() => onChange(option)} className="size-4 accent-[var(--form-accent)]" />
              {option}
            </label>
          ))}
        </div>
        {field.help ? (
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            {field.help}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }
  return (
    <Labelled id={id} label={field.label} required={field.required} help={field.help} error={error}>
      {field.kind === "choice" ? (
        <select {...shared} value={text} onChange={(event) => onChange(event.target.value)} className={cn(control, "cursor-pointer")}>
          <option value="">Choose one</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "longtext" ? (
        <textarea {...shared} rows={4} value={text} onChange={(event) => onChange(event.target.value)} className={cn(control, "min-h-28")} />
      ) : (
        <input
          {...shared}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          type={field.kind === "date" ? "date" : field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "text"}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          autoComplete={field.kind === "postal_code" ? "postal-code" : field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "off"}
          className={control}
        />
      )}
    </Labelled>
  );
}

export function BookingFormBody({
  definition,
  company,
  services,
  values,
  onChange,
  problems,
  onSubmit,
  busy,
  preview,
}: {
  definition: FormDefinition;
  company: string;
  services: FormService[];
  values: FormValues;
  onChange: (next: FormValues) => void;
  problems: Record<string, string>;
  onSubmit?: () => void;
  busy?: boolean;
  /** In the builder: everything renders and can be tried, and nothing is sent. */
  preview?: boolean;
}) {
  const id = useId();
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => onChange({ ...values, [key]: value });
  const shown = definition.fields.filter((field) => isShown(field, values.answers));
  return (
    <form
      noValidate
      style={{ ["--form-accent" as string]: definition.accent ?? "var(--color-brand-500)" }}
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview) onSubmit?.();
      }}
    >
      <header className="grid gap-2">
        <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{company}</p>
        <h1 className="font-heading text-2xl leading-tight tracking-tight text-strong">{definition.title}</h1>
        {definition.intro ? <p className="text-sm leading-relaxed text-muted-foreground">{definition.intro}</p> : null}
        <p className="w-fit rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">{definition.intent === "booking_request" ? "A request for a time. Not a confirmed booking." : "A request for a price. Not a booking."}</p>
      </header>

      <div className="grid gap-4">
        <Labelled id={`${id}-name`} label="Your name" required error={problems.name}>
          <input id={`${id}-name`} value={values.name} onChange={(event) => set("name", event.target.value)} autoComplete="name" required aria-invalid={problems.name ? true : undefined} disabled={busy} className={control} />
        </Labelled>
        <Labelled id={`${id}-email`} label="Email" required={false} error={problems.email} help="Give an email address, a mobile number, or both, so we can reply.">
          <input id={`${id}-email`} type="email" value={values.email} onChange={(event) => set("email", event.target.value)} autoComplete="email" aria-invalid={problems.email ? true : undefined} aria-describedby={`${id}-email-help`} disabled={busy} className={control} />
        </Labelled>
        <Labelled id={`${id}-phone`} label="Mobile number" required={false} error={problems.phone}>
          <input id={`${id}-phone`} type="tel" value={values.phone} onChange={(event) => set("phone", event.target.value)} autoComplete="tel" aria-invalid={problems.phone ? true : undefined} disabled={busy} className={control} />
        </Labelled>
        {services.length > 0 ? (
          <Labelled id={`${id}-service`} label="Service" required={false} error={problems.service}>
            <select id={`${id}-service`} value={values.serviceKey} onChange={(event) => set("serviceKey", event.target.value)} disabled={busy} className={cn(control, "cursor-pointer")}>
              <option value="">Not sure yet</option>
              {services.map((service) => (
                <option key={service.key} value={service.key}>
                  {service.name}
                </option>
              ))}
            </select>
          </Labelled>
        ) : null}
        {shown.map((field) => (
          <Question key={field.id} field={field} value={values.answers[field.id]} error={problems[field.id]} disabled={busy} onChange={(value) => set("answers", { ...values.answers, [field.id]: value })} />
        ))}
      </div>

      {/* Not for people: a script that fills every field fills this one too, and its submission is dropped. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={values.website} onChange={(event) => set("website", event.target.value)} />
        </label>
      </div>

      {definition.consent.sms ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-strong has-focus-visible:outline-2 has-focus-visible:outline-[var(--form-accent)]">
          <input type="checkbox" checked={values.smsConsent} onChange={(event) => set("smsConsent", event.target.checked)} disabled={busy} className="mt-0.5 size-5 shrink-0 accent-[var(--form-accent)]" />
          <span className="leading-relaxed">{definition.consent.smsText}</span>
        </label>
      ) : null}

      {problems.form ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive-foreground">
          {problems.form}
        </p>
      ) : null}
      <div className="grid gap-2">
        <button type="submit" disabled={busy || preview} className="min-h-12 w-full rounded-xl bg-[var(--form-accent)] px-4 text-base font-semibold text-white shadow-[0_10px_28px_-14px_var(--form-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--form-accent)] disabled:opacity-70">
          {busy ? "Sending…" : definition.submitLabel}
        </button>
        {preview ? <p className="text-center text-xs text-muted-foreground">Preview: nothing is sent from here.</p> : null}
      </div>
    </form>
  );
}

export function FormConfirmation({ title, body, company }: { title: string; body: string; company: string }) {
  return (
    <div className="grid gap-2 py-6 text-center" role="status">
      <span aria-hidden className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <h1 className="font-heading text-2xl tracking-tight text-strong">{title}</h1>
      <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      <p className="mt-2 text-xs text-muted-foreground">{company}</p>
    </div>
  );
}
