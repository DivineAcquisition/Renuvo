"use client";

import { useCallback, useEffect, useState } from "react";

import { CheckCircle2, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one save area of a Settings form. It stays at the bottom of the screen while there is something
 * to save, so it is always reachable, and sits in the page flow otherwise, so it never covers content.
 * It says what is happening in words: unsaved, saving, saved, or what went wrong and that the edits are kept.
 */
export function SaveBar({
  canEdit,
  dirty,
  saving,
  error,
  notice,
  problems = [],
  stale = false,
  staleMessage = "Someone else saved changes here after you started editing. Your edits are kept below. Discard them to see the latest version.",
  saveLabel = "Save changes",
  onSave,
  onDiscard,
}: {
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  notice?: string | null;
  problems?: readonly string[];
  stale?: boolean;
  staleMessage?: string;
  saveLabel?: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!canEdit) return null;
  const blocked = problems.length > 0 || stale;
  return (
    <div
      className={cn(
        "z-20 grid gap-2 rounded-2xl border bg-card px-4 py-3 transition-shadow sm:px-5",
        dirty ? "sticky bottom-3 border-brand-500/40 shadow-lg shadow-black/5" : "border-border",
      )}
    >
      {stale ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-strong">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {staleMessage}
        </p>
      ) : null}
      {dirty && problems.length > 0 ? (
        <div role="alert" className="text-sm text-destructive-foreground">
          <p className="font-medium">Fix {problems.length === 1 ? "this" : "these"} before saving:</p>
          <ul className="mt-0.5 grid list-disc gap-0.5 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {error} <span className="text-muted-foreground">Your edits are still here.</span>
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" size="sm" loading={saving} disabled={!dirty || blocked || saving} onClick={onSave}>
          {saving ? "Saving…" : saveLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={onDiscard}>
          Discard changes
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {saving ? "Saving your changes…" : dirty ? "You have unsaved changes." : notice ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 aria-hidden className="size-3.5" />
              {notice}
            </span>
          ) : "All changes saved."}
        </span>
      </div>
    </div>
  );
}

/**
 * Asks before unsaved edits are lost: on closing or reloading the tab, and on following a link the
 * edits would not survive. `keeps` says which in-app links are safe (for example, other Settings pages
 * when the draft lives above them). History buttons are left alone.
 */
export function useUnsavedWarning(dirty: boolean, keeps: (target: URL) => boolean = () => false) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      let target: URL;
      try {
        target = new URL(link.href, window.location.origin);
      } catch {
        return;
      }
      const here = target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search;
      if (here || (target.origin === window.location.origin && keeps(target))) return;
      if (!window.confirm("You have unsaved changes. Leave without saving them?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, keeps]);
}

/**
 * A form's edits held apart from what is saved. The saved value keeps updating live; edits are never
 * replaced by it. If it changes while there are edits, the form is "stale": the edits are kept and the
 * person is told, instead of either side silently winning.
 */
export function useSavedDraft<T>(saved: T | undefined) {
  const [edits, setEdits] = useState<{ value: T; base: string } | null>(null);
  const savedJson = saved === undefined ? undefined : JSON.stringify(saved);
  const value = edits?.value ?? saved;
  const dirty = Boolean(edits && JSON.stringify(edits.value) !== edits.base);
  const stale = Boolean(edits && dirty && savedJson !== undefined && savedJson !== edits.base);
  const change = useCallback(
    (update: (current: T) => T) => {
      if (saved === undefined) return;
      setEdits((current) => ({ value: update(current?.value ?? saved), base: current?.base ?? JSON.stringify(saved) }));
    },
    [saved],
  );
  const reset = useCallback(() => setEdits(null), []);
  return { value, dirty, stale, change, reset };
}
