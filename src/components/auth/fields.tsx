"use client";

import { useEffect, useId, useState } from "react";

import { AlertTriangle, Check, CircleCheckIcon, Eye, EyeOffIcon, Loader } from "@/components/icons";
import type { Requirement } from "@/lib/auth/password";
import { cn } from "@/lib/utils";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id">;

/** A labelled field. The label is always visible, and an error is tied to the input and announced. */
export function TextField({ label, error, hint, trailing, ...props }: InputProps & { label: string; error?: string | null; hint?: React.ReactNode; trailing?: React.ReactNode }) {
  const id = useId();
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-[#211a35]">
          {label}
        </label>
        {trailing}
      </div>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={described} {...props} className={cn("auth-input", props.className)} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-[#667085]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-700">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A password field with a show and hide control. What is typed is never trimmed or altered. */
export function PasswordField({ label, error, hint, trailing, ...props }: InputProps & { label: string; error?: string | null; hint?: React.ReactNode; trailing?: React.ReactNode }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-[#211a35]">
          {label}
        </label>
        {trailing}
      </div>
      <div className="relative">
        <input id={id} type={shown ? "text" : "password"} aria-invalid={error ? true : undefined} aria-describedby={described} spellCheck={false} autoCapitalize="none" autoCorrect="off" {...props} className={cn("auth-input pr-12", props.className)} />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
          aria-controls={id}
          className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-[#667085] hover:bg-[#f1f3f8] hover:text-[#211a35] focus-visible:outline-2 focus-visible:outline-[#6838ef]"
        >
          {shown ? <EyeOffIcon className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          <span className="sr-only">{shown ? "Hide password" : "Show password"}</span>
        </button>
      </div>
      {hint ? (
        <div id={`${id}-hint`} className="text-xs leading-relaxed text-[#667085]">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-700">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The six-digit code from an email. Browsers and phones can fill it in from the message. */
export function CodeField({ label = "Code", error, hint, value, onChange, disabled, autoFocus }: { label?: string; error?: string | null; hint?: React.ReactNode; value: string; onChange: (value: string) => void; disabled?: boolean; autoFocus?: boolean }) {
  return (
    <TextField
      label={label}
      error={error}
      hint={hint}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      required
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder="000000"
      className="font-mono text-lg tracking-[0.5em]"
    />
  );
}

/** The password rules, each with a mark and words, so nothing depends on colour alone. */
export function Requirements({ rows, extra }: { rows: Requirement[]; extra?: string }) {
  return (
    <ul className="grid gap-1">
      {rows.map((row) => (
        <li key={row.key} className={cn("flex items-center gap-1.5", row.met ? "text-emerald-700" : "text-[#667085]")}>
          <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full border", row.met ? "border-emerald-600 bg-emerald-600 text-white" : "border-[#b9c0cf]")} aria-hidden>
            {row.met ? <Check className="size-2.5" /> : null}
          </span>
          <span>
            {row.label}
            <span className="sr-only">{row.met ? " (met)" : " (not met yet)"}</span>
          </span>
        </li>
      ))}
      {extra ? <li className="pl-5 text-[#667085]">{extra}</li> : null}
    </ul>
  );
}

/**
 * Agreement to the Terms and the Privacy Policy, ticked by the person themselves (never pre-ticked).
 * The documents open in a new tab, so what is typed in the form is not lost.
 */
export function ConsentField({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  const link = "rounded font-medium text-[#5126c7] underline underline-offset-4 hover:text-[#3f1ca3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]";
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[#e4e0f5] bg-[#f8f6ff] px-3.5 py-3">
      <input
        id={id}
        type="checkbox"
        name="legal-accepted"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        required
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-[#b9c0cf] accent-[#6838ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed text-[#475467]">
        I agree to Selestial&rsquo;s{" "}
        <a href="/terms" target="_blank" rel="noopener" className={link}>
          Terms of Service
          <span className="sr-only"> (opens in a new tab)</span>
        </a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noopener" className={link}>
          Privacy Policy
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </label>
    </div>
  );
}

/** The main button of a form. While the request runs it is disabled, so it cannot be sent twice. */
export function SubmitButton({ busy, children, busyLabel, disabled }: { busy: boolean; children: React.ReactNode; busyLabel: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy}
      className="icon-gradient relative flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#5126c7]/40 px-4 text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_24px_-14px_rgba(104,56,239,0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef] disabled:cursor-not-allowed disabled:shadow-none"
    >
      {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
      {busy ? busyLabel : children}
    </button>
  );
}

/** A quieter button, for a second action such as sending a code again. */
export function QuietButton({ children, onClick, disabled, type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#d5dae5] bg-white px-4 text-[15px] font-medium text-[#211a35] transition-colors hover:border-[#b9c0cf] hover:bg-[#f8f9fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef] disabled:cursor-not-allowed disabled:text-[#667085]"
    >
      {children}
    </button>
  );
}

/** The result of a submission. It is announced to screen readers, and has an icon as well as a colour. */
export function Notice({ tone, children, title }: { tone: "error" | "success" | "info"; children: React.ReactNode; title?: string }) {
  const look = { error: "border-red-200 bg-red-50 text-red-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800", info: "border-[#d9cfff] bg-[#eee8ff] text-[#3f1d9e]" }[tone];
  const Icon = tone === "success" ? CircleCheckIcon : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed", look)}>
      {tone === "info" ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

/**
 * A wait before something can be asked for again, such as a new code. The end time is kept in the
 * browser tab, so reloading the page does not reset it. The service applies its own limits as well.
 */
export function useCooldown(key: string, seconds: number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const read = () => {
      let until = 0;
      try {
        until = Number(window.sessionStorage.getItem(key) ?? 0);
      } catch {
        until = 0;
      }
      setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [key]);
  const start = () => {
    try {
      window.sessionStorage.setItem(key, String(Date.now() + seconds * 1000));
    } catch {
      // Without storage the wait lasts until the page is reloaded.
    }
    setLeft(seconds);
  };
  return { left, start };
}
