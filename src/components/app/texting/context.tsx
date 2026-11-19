"use client";

/**
 * The saved texting setup, shared by every step. Every change is sent to the server as it is made and the
 * revision it was based on travels with it, so an older tab can never overwrite a newer one. Saves are
 * queued one at a time; the screen always shows whether the latest change is saved.
 */
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import { messageOf } from "@/components/app/form";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type View = NonNullable<FunctionReturnType<typeof api.textingSetup.view>>;
export type StepId = View["setup"]["step"];
export type SavePatch = Omit<Parameters<ReturnType<typeof useMutation<typeof api.textingSetup.save>>>[0], "companyId" | "revision">;

type Ctx = {
  view: View;
  companyId: Id<"companies">;
  step: StepId;
  go: (step: StepId) => Promise<void>;
  /** Saves a change. Answers whether it was saved. */
  commit: (patch: SavePatch) => Promise<boolean>;
  /** Runs any change that is based on the current revision and answers with the next one. */
  run: (fn: (revision: number) => Promise<{ revision: number } | null | void>) => Promise<boolean>;
  saving: "saved" | "saving" | "failed";
  error: string | null;
  clearError: () => void;
  locked: boolean;
};

const SetupContext = createContext<Ctx | null>(null);

export function useSetup(): Ctx {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error("useSetup needs a SetupProvider");
  return ctx;
}

export function SetupProvider({ view, companyId, initialStep, onConflict, children }: { view: View; companyId: Id<"companies">; initialStep: StepId; onConflict: () => void; children: React.ReactNode }) {
  const save = useMutation(api.textingSetup.save);
  const [step, setStep] = useState<StepId>(initialStep);
  const [saving, setSaving] = useState<Ctx["saving"]>("saved");
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(view.setup.revision);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The server's revision moves on with every save; never go backwards to an older one.
  if (view.setup.revision > revision.current) revision.current = view.setup.revision;

  const run = useCallback<Ctx["run"]>(
    (fn) => {
      const next = queue.current.then(async () => {
        setSaving("saving");
        setError(null);
        try {
          const result = await fn(revision.current);
          if (result && typeof result.revision === "number") revision.current = Math.max(revision.current, result.revision);
          setSaving("saved");
          return true;
        } catch (caught) {
          const words = messageOf(caught);
          setSaving("failed");
          setError(words);
          if (/another window/.test(words)) onConflict();
          return false;
        }
      });
      queue.current = next;
      return next;
    },
    [onConflict],
  );

  const commit = useCallback<Ctx["commit"]>((patch) => run((rev) => save({ companyId, revision: rev, ...patch })), [run, save, companyId]);

  const go = useCallback(
    async (to: StepId) => {
      setStep(to);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("step", to);
        window.history.replaceState(null, "", url);
        window.scrollTo({ top: 0 });
      }
      await commit({ step: to });
    },
    [commit],
  );

  return <SetupContext.Provider value={{ view, companyId, step, go, commit, run, saving, error, clearError: () => setError(null), locked: !view.editable }}>{children}</SetupContext.Provider>;
}

/** "+15125550142" as "(512) 555-0142". */
export function formatPhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : (value ?? "");
}
