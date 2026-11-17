"use client";

/**
 * The directory's search, filters, view and open profile live in the address, so opening and closing a
 * profile, going back, reloading or sharing the link all keep exactly what the person was looking at.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { CLEANERS_PATH, isSection } from "@/lib/app/cleaners";

export { CLEANERS_PATH, isSection, profilePath, SECTIONS, type SectionId } from "@/lib/app/cleaners";

export const FILTER_KEYS = ["q", "type", "status", "ready", "crew", "area", "skill", "stage", "sub", "focus", "avail", "view", "ended"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type DirectoryState = Partial<Record<FilterKey, string>> & { cleaner?: string; section?: string };

const LAST_DIRECTORY = "selestial.cleaners.directory";

/** Remembers the directory's address so a profile's "Cleaners" link returns to the same search and filters. */
export function rememberDirectory(search: string) {
  try {
    sessionStorage.setItem(LAST_DIRECTORY, search);
  } catch {
    // Private windows may refuse storage; the link then opens the plain directory.
  }
}

export function directoryHref(): string {
  try {
    const saved = sessionStorage.getItem(LAST_DIRECTORY);
    return saved ? `${CLEANERS_PATH}${saved}` : CLEANERS_PATH;
  } catch {
    return CLEANERS_PATH;
  }
}

export function useDirectoryState(): [DirectoryState, (next: Partial<DirectoryState>, mode?: "push" | "replace") => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const state = useMemo<DirectoryState>(() => {
    const out: DirectoryState = {};
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) out[key] = value;
    }
    const cleaner = params.get("cleaner");
    if (cleaner && /^[a-z0-9]{8,64}$/i.test(cleaner)) out.cleaner = cleaner;
    const section = params.get("section");
    if (isSection(section)) out.section = section;
    return out;
  }, [params]);

  const update = useCallback(
    (next: Partial<DirectoryState>, mode: "push" | "replace" = "replace") => {
      const url = new URL(window.location.href);
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === null || value === "") url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      const target = `${url.pathname}${url.search}${url.hash}`;
      if (mode === "push") window.history.pushState(null, "", target);
      else window.history.replaceState(null, "", target);
      if (url.pathname === pathname) {
        const filtersOnly = new URLSearchParams(url.search);
        filtersOnly.delete("cleaner");
        filtersOnly.delete("section");
        const rest = filtersOnly.toString();
        rememberDirectory(rest ? `?${rest}` : "");
      }
    },
    [pathname],
  );
  return [state, update];
}
