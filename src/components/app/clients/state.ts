"use client";

/**
 * The directory's view, search, filters, sort and open quick view live in the address, so opening a client,
 * going back, reloading or sharing a link keeps exactly what the person was looking at. The last directory
 * address is remembered, so a profile's "Clients" link returns to it, with the scroll position.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { CLIENTS_PATH, DIRECTORY_VIEWS, isRecordId, isTab, type DirectoryView, type TabId } from "@/lib/app/clients";

export const FILTER_KEYS = ["view", "q", "rel", "owner", "attention", "sort"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type DirectoryState = Partial<Record<FilterKey, string>> & { client?: string; tab?: TabId };

const LAST = "selestial.clients.directory";
const SCROLL = "selestial.clients.scroll";

export function rememberDirectory(search: string) {
  try {
    sessionStorage.setItem(LAST, search);
  } catch {
    // Private windows may refuse storage; the link then opens the plain directory.
  }
}

export function rememberScroll() {
  try {
    sessionStorage.setItem(SCROLL, String(window.scrollY));
  } catch {
    // As above.
  }
}

/** The scroll position to return to, once. */
export function takeScroll(): number | null {
  try {
    const value = sessionStorage.getItem(SCROLL);
    sessionStorage.removeItem(SCROLL);
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

export function directoryHref(): string {
  try {
    const saved = sessionStorage.getItem(LAST);
    return saved ? `${CLIENTS_PATH}${saved}` : CLIENTS_PATH;
  } catch {
    return CLIENTS_PATH;
  }
}

export function viewOf(state: DirectoryState): DirectoryView {
  return DIRECTORY_VIEWS.includes(state.view as DirectoryView) ? (state.view as DirectoryView) : "all";
}

export function useDirectoryState(): [DirectoryState, (next: Partial<DirectoryState>, mode?: "push" | "replace") => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const state = useMemo<DirectoryState>(() => {
    const out: DirectoryState = {};
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) out[key] = value.slice(0, 100);
    }
    const client = params.get("client");
    if (isRecordId(client)) out.client = client;
    const tab = params.get("tab");
    if (isTab(tab)) out.tab = tab;
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
        filtersOnly.delete("client");
        filtersOnly.delete("tab");
        const rest = filtersOnly.toString();
        rememberDirectory(rest ? `?${rest}` : "");
      }
    },
    [pathname],
  );
  return [state, update];
}
