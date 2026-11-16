"use client";

import { useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Guard } from "@/components/app/settings/guard";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { type BusinessDraft, draftFrom, isDirty, leavesSettings, localProblems, payloadFrom, type SavedBusiness } from "@/lib/app/settings-draft";

import { api } from "../../../../convex/_generated/api";

type BusinessState = {
  /** The saved record, or undefined while it loads. */
  saved: SavedBusiness | undefined;
  /** Set when the settings could not be read at all, for example because the server is behind this page. */
  unavailable: unknown;
  canEdit: boolean;
  configured: boolean;
  draft: BusinessDraft | undefined;
  edit: (change: (current: BusinessDraft) => BusinessDraft) => void;
  dirty: boolean;
  /** True when the record was saved by someone else after this draft was started. */
  stale: boolean;
  problems: string[];
  saving: boolean;
  error: string | null;
  notice: string | null;
  save: () => Promise<void>;
  /** Drops the unsaved edits and shows what is saved now. */
  discard: () => void;
};

const Context = createContext<BusinessState | null>(null);

export function useBusinessDraft(): BusinessState {
  const value = useContext(Context);
  if (!value) throw new Error("useBusinessDraft needs a BusinessDraftProvider");
  return value;
}

/**
 * Holds the business draft for everything under Settings. It lives in the Settings layout, so edits
 * survive moving between sections. A newer saved record never replaces unsaved edits: the draft keeps
 * the revision it started from, and the page says it is out of date instead of overwriting.
 */
function LoadedDraft({ children }: { children: React.ReactNode }) {
  const { companyId } = useCompany();
  const record = useQuery(api.settings.business, { companyId });
  const saveBusiness = useMutation(api.settings.saveBusiness);
  const [edits, setEdits] = useState<{ draft: BusinessDraft; baseRevision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saved = record as SavedBusiness | undefined;
  const draft = edits?.draft ?? (saved ? draftFrom(saved) : undefined);
  const dirty = Boolean(saved && edits && isDirty(edits.draft, saved));
  const stale = Boolean(saved && edits && dirty && edits.baseRevision !== saved.revision);
  const problems = useMemo(() => (draft && dirty ? localProblems(draft) : []), [draft, dirty]);

  const edit = useCallback(
    (change: (current: BusinessDraft) => BusinessDraft) => {
      if (!saved) return;
      setNotice(null);
      setEdits((current) => ({ draft: change(current?.draft ?? draftFrom(saved)), baseRevision: current?.baseRevision ?? saved.revision }));
    },
    [saved],
  );

  const discard = useCallback(() => {
    setEdits(null);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!saved || !edits || !dirty || stale || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveBusiness({ companyId, expectedRevision: edits.baseRevision, ...payloadFrom(edits.draft) });
      setEdits(null);
      setNotice(result.changed ? "Saved." : "Nothing had changed.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  }, [companyId, dirty, edits, problems.length, saveBusiness, saved, stale]);

  // Leaving the page with unsaved edits asks first. History buttons are left alone on purpose.
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
      if (!leavesSettings(link.href, window.location.origin, { pathname: window.location.pathname, search: window.location.search })) return;
      if (!window.confirm("You have unsaved changes in Settings. Leave without saving?")) {
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
  }, [dirty]);

  const value: BusinessState = {
    saved,
    unavailable: null,
    canEdit: record?.canEdit ?? false,
    configured: record?.configured ?? false,
    draft,
    edit,
    dirty,
    stale,
    problems,
    saving,
    error,
    notice,
    save,
    discard,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const NOTHING = () => undefined;

/** Reads fail without taking the page down: the pages that need the draft say so, and the rest of Settings keeps working. */
export function BusinessDraftProvider({ children }: { children: React.ReactNode }) {
  return (
    <Guard
      fallback={(error) => (
        <Context.Provider
          value={{ saved: undefined, unavailable: error ?? true, canEdit: false, configured: false, draft: undefined, edit: NOTHING, dirty: false, stale: false, problems: [], saving: false, error: null, notice: null, save: async () => undefined, discard: NOTHING }}
        >
          {children}
        </Context.Provider>
      )}
    >
      <LoadedDraft>{children}</LoadedDraft>
    </Guard>
  );
}
