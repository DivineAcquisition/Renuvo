"use client";

/**
 * The saved migration as every step sees it: the live view from the server, the step on screen, and one
 * way to save a change that reports what went wrong in words. Every entry point opens this same migration.
 */
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useState } from "react";

import { messageOf } from "@/components/app/form";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type View = NonNullable<FunctionReturnType<typeof api.migration.view>>;
export type StepId = View["migration"]["step"];
export type FileView = View["files"][number];

type Save = { step?: StepId; source?: NonNullable<View["migration"]["source"]>; wants?: View["migration"]["wants"]; timezone?: string; timezoneConfirmed?: boolean; dateOrder?: "mdy" | "dmy" | null };

type Value = {
  view: View;
  companyId: Id<"companies">;
  step: StepId;
  go: (step: StepId) => Promise<void>;
  save: (patch: Save) => Promise<boolean>;
  /** Runs any request, keeping its problem in words for the step to show. */
  act: <T>(work: () => Promise<T>) => Promise<T | undefined>;
  busy: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  locked: boolean;
};

const MigrationContext = createContext<Value | null>(null);

export function MigrationProvider({ view, companyId, initialStep, children }: { view: View; companyId: Id<"companies">; initialStep: StepId; children: React.ReactNode }) {
  const [step, setStep] = useState<StepId>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveMutation = useMutation(api.migration.save);

  async function act<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (caught) {
      setError(messageOf(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: Save): Promise<boolean> {
    const done = await act(() => saveMutation({ companyId, revision: view.migration.revision, ...patch }));
    return done !== undefined;
  }

  async function go(next: StepId) {
    setStep(next);
    setError(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("step", next);
      window.history.replaceState(null, "", url);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (next !== view.migration.step && view.migration.status !== "importing") await save({ step: next });
  }

  const locked = view.migration.status === "importing";
  return <MigrationContext.Provider value={{ view, companyId, step, go, save, act, busy, error, setError, locked }}>{children}</MigrationContext.Provider>;
}

export function useMigration(): Value {
  const value = useContext(MigrationContext);
  if (!value) throw new Error("useMigration outside MigrationProvider");
  return value;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A spreadsheet cell that starts like a formula is written with a leading apostrophe, so opening the report runs nothing. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
