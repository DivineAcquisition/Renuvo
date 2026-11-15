"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState, type ReactNode } from "react";

import { convexUrl } from "@/lib/app/config";
import { cn } from "@/lib/utils";

let client: ConvexReactClient | null = null;

/** The live record for the cleaner pages. No sign-in: the link in the address is the only authorization. */
export function CleanerProviders({ children }: { children: ReactNode }) {
  const url = convexUrl();
  if (!url) {
    return (
      <Page company={null} title="Not available yet">
        <Notice tone="neutral" title="This page is not set up yet">
          Please contact the office that sent you this link.
        </Notice>
      </Page>
    );
  }
  client ??= new ConvexReactClient(url);
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

/** The words meant for a person from a refused action, or a plain fallback. Never a stack or a raw response. */
export function problemWords(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "That did not go through. Check your connection and try again.";
}

export function Page({ company, title, children }: { company: string | null; title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-5 pb-28">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase" data-testid="company">
          {company ?? "Selestial"}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </header>
      {children}
    </main>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-4", className)}>
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

const TONES = {
  neutral: "border-border bg-muted/40",
  good: "border-emerald-500/40 bg-emerald-500/10",
  warn: "border-amber-500/40 bg-amber-500/10",
  bad: "border-red-500/40 bg-red-500/10",
} as const;

export function Notice({ tone, title, children, testId }: { tone: keyof typeof TONES; title: string; children?: ReactNode; testId?: string }) {
  return (
    <div role="status" data-testid={testId} className={cn("flex flex-col gap-1 rounded-2xl border p-4 text-sm", TONES[tone])}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
      {message}
    </p>
  );
}

const BUTTONS = {
  primary: "bg-brand-500 text-white active:bg-brand-700",
  secondary: "border border-border bg-background text-foreground active:bg-muted",
  danger: "border border-red-500/50 bg-background text-red-600 active:bg-red-500/10",
} as const;

/** A full-width button sized for a thumb. While its action runs it is disabled, so a double tap is one request. */
export function Action({ kind = "primary", busy = false, disabled = false, onPress, children, testId }: { kind?: keyof typeof BUTTONS; busy?: boolean; disabled?: boolean; onPress: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={onPress}
      className={cn("min-h-12 w-full rounded-xl px-4 text-base font-semibold transition-opacity disabled:opacity-50", BUTTONS[kind])}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <Page company={null} title="Loading…">
      <div aria-busy="true" className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        <p className="sr-only">Loading {what}</p>
      </div>
    </Page>
  );
}

/** Text a cleaner has typed, kept on this phone until it is sent, so a dropped connection or a closed tab loses nothing. */
export function useDraft(key: string): [string, (value: string) => void, () => void] {
  const storageKey = `selestial.draft.${key}`;
  const [value, setValue] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // Restoring a saved draft once, after the page is on the phone.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setValue(saved);
    } catch {
      // Private mode or no storage: the draft just is not kept.
    }
  }, [storageKey]);
  const set = (next: string) => {
    setValue(next);
    try {
      if (next) window.localStorage.setItem(storageKey, next);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Ignored for the same reason.
    }
  };
  return [value, set, () => set("")];
}

/** The part of a link that names it, without the signature: safe to use as a key on the phone. */
export function linkKey(token: string): string {
  return token.split(".")[0] ?? "link";
}

export function TextBox({ value, onChange, placeholder, label, testId }: { value: string; onChange: (value: string) => void; placeholder?: string; label: string; testId?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={1000}
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base outline-none focus:border-brand-500"
      />
    </label>
  );
}
