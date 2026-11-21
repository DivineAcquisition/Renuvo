"use client";

import { useId, useState } from "react";

import { CheckCircle2, Info, Mail, Phone } from "@/components/icons";
import { joinIds, markComposite, useFieldControl } from "@/components/ui/selection/field-context";
import { cn } from "@/lib/utils";

const digits = (text: string) => text.replace(/\D/g, "");

/** A US number as people write it, once it has all its digits; otherwise what was typed. */
export function formatUsPhone(text: string): string {
  const d = digits(text).replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : text.trim();
}

export function phoneProblem(text: string): string | null {
  if (!text.trim()) return null;
  const d = digits(text).replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10) return "Enter a 10-digit US phone number, like (512) 555-0100.";
  if (/^[01]/.test(d) || /^\d{3}[01]/.test(d)) return "That isn't a US phone number. Check the area code and the next three digits.";
  return null;
}

export function emailProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/\s/.test(t)) return "An email address can't contain spaces.";
  if (!/^[^@]+@[^@]+\.[^@.]{2,}$/.test(t)) return "Enter an email address like name@example.com.";
  return null;
}

type Props = {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
  /** "home" or "work"-style autocomplete tokens where the form knows which it is. */
  autoComplete?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

function useContactField(value: string, problemOf: (text: string) => string | null, idProp?: string, describedBy?: string) {
  const field = useFieldControl();
  const own = useId();
  const id = idProp ?? field?.controlId ?? own;
  const [touched, setTouched] = useState(false);
  const problem = touched ? problemOf(value) : null;
  return { id, field, problem, problemId: `${id}-problem`, setTouched, describedBy: joinIds(describedBy, field?.describedBy, problem ? `${id}-problem` : undefined) };
}

const shell = "flex min-h-control-md items-center gap-2 rounded-lg border bg-card pl-3 text-sm has-[:focus-visible]:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_60%,var(--border))] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)]";

/**
 * A phone number: the phone keypad on mobile, the browser's saved number, and the number written out the
 * usual way when the field is left. A number that is the right shape is only that; it is not verified and
 * it is not permission to text. Use ContactStatus to show those separately.
 */
export function PhoneInput({ value, onChange, disabled, readOnly, required, placeholder = "(512) 555-0100", id, name, className, autoComplete = "tel", ...aria }: Props) {
  const c = useContactField(value, phoneProblem, id, aria["aria-describedby"]);
  return (
    <div className={cn("grid gap-1", className)}>
      <div className={cn(shell, c.problem || c.field?.invalid ? "border-destructive/60" : "border-border", (disabled || readOnly) && "bg-muted/50")}>
        <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          id={c.id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          required={required ?? c.field?.required}
          placeholder={placeholder}
          aria-label={aria["aria-label"]}
          aria-invalid={Boolean(c.problem) || c.field?.invalid || undefined}
          aria-describedby={c.describedBy}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            c.setTouched(true);
            if (!phoneProblem(value)) {
              const formatted = formatUsPhone(value);
              if (formatted !== value) onChange(formatted);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent py-2 pr-3 text-strong outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
      </div>
      {c.problem ? (
        <p id={c.problemId} className="text-xs font-medium text-destructive-foreground">
          {c.problem}
        </p>
      ) : null}
    </div>
  );
}
markComposite(PhoneInput);

/** An email address: the email keyboard, the browser's saved address, and spaces trimmed when left. */
export function EmailInput({ value, onChange, disabled, readOnly, required, placeholder = "name@example.com", id, name, className, autoComplete = "email", ...aria }: Props) {
  const c = useContactField(value, emailProblem, id, aria["aria-describedby"]);
  return (
    <div className={cn("grid gap-1", className)}>
      <div className={cn(shell, c.problem || c.field?.invalid ? "border-destructive/60" : "border-border", (disabled || readOnly) && "bg-muted/50")}>
        <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          id={c.id}
          name={name}
          type="email"
          inputMode="email"
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          required={required ?? c.field?.required}
          placeholder={placeholder}
          aria-label={aria["aria-label"]}
          aria-invalid={Boolean(c.problem) || c.field?.invalid || undefined}
          aria-describedby={c.describedBy}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            c.setTouched(true);
            if (value !== value.trim()) onChange(value.trim());
          }}
          className="h-full min-w-0 flex-1 bg-transparent py-2 pr-3 text-strong outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
      </div>
      {c.problem ? (
        <p id={c.problemId} className="text-xs font-medium text-destructive-foreground">
          {c.problem}
        </p>
      ) : null}
    </div>
  );
}
markComposite(EmailInput);

/**
 * What is known about a contact detail, kept as separate facts: the shape is right; it has been verified
 * (a code or link was answered); there is recorded permission to text; texting is set up. "Ready to text"
 * appears only when every texting requirement is actually met.
 */
export function ContactStatus({ kind, wellFormed, verified, consent, textingReady }: { kind: "phone" | "email"; wellFormed: boolean; verified?: boolean; consent?: "granted" | "declined" | "unknown"; textingReady?: boolean }) {
  if (!wellFormed) return null;
  const ready = kind === "phone" && consent === "granted" && textingReady === true;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" aria-label="About this contact detail">
      <li>{kind === "phone" ? "Number format looks right" : "Address format looks right"}</li>
      {verified !== undefined ? <li>{verified ? "Verified" : "Not verified"}</li> : null}
      {kind === "phone" && consent !== undefined ? <li>{consent === "granted" ? "Agreed to texts" : consent === "declined" ? "Said no to texts" : "No texting permission recorded"}</li> : null}
      {ready ? (
        <li className="inline-flex items-center gap-1 text-success-foreground">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Ready to text
        </li>
      ) : kind === "phone" && consent !== undefined ? (
        <li className="inline-flex items-center gap-1">
          <Info className="size-3.5" aria-hidden />
          Texting needs an approved business number and recorded permission
        </li>
      ) : null}
    </ul>
  );
}
