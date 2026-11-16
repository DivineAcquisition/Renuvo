"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { AUTH, NEXT_PARAM, safeNext, withNext } from "@/lib/auth/routes";

type Router = ReturnType<typeof useRouter>;
type Finishable = { finalize: (params?: { navigate?: (params: { session: { currentTask?: unknown } | null; decorateUrl: (url: string) => string }) => void | Promise<unknown> }) => Promise<{ error: unknown }> };

/** Where a finished sign-in goes when the sign-in service still wants a step Selestial does not use. */
export const SETUP_PROBLEM = `${AUTH.error}?reason=setup`;

/**
 * Sends the browser on after a session opens. If the sign-in service has left the session waiting on
 * a step of its own (its organizations feature, a forced second factor), the session is not usable
 * here, and the person is told that setup is unfinished instead of being bounced between pages.
 */
export function goOn(router: Router, destination: string) {
  return ({ session, decorateUrl }: { session: { currentTask?: unknown } | null; decorateUrl: (url: string) => string }) => {
    const url = decorateUrl(session?.currentTask ? SETUP_PROBLEM : destination);
    if (/^https?:/i.test(url)) window.location.href = url;
    else router.replace(url);
  };
}

/**
 * Turns a finished sign-in or sign-up into a live session and moves on. The destination is always
 * the callback page, which confirms the session before it sends the person anywhere.
 */
export async function enter(resource: Finishable, router: Router, next: string | null): Promise<unknown> {
  const destination = withNext(AUTH.callback, next);
  const { error } = await resource.finalize({ navigate: goOn(router, destination) });
  return error ?? null;
}

/** Where the person was going, read from the address bar and checked. Never an outside address. */
export function useNext(): string | null {
  return safeNext(useSearchParams().get(NEXT_PARAM));
}

/** Sends a person who is already signed in onward. Used on pages that only make sense signed out. */
export function useSkipWhenSignedIn(enabled: boolean, next: string | null) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (enabled && isLoaded && isSignedIn) router.replace(withNext(AUTH.callback, next));
  }, [enabled, isLoaded, isSignedIn, next, router]);
  return isLoaded && isSignedIn;
}

/** Small notes one sign-in screen leaves for the next, in this browser tab only. Never a password or a code. */
export const tab = {
  get<T>(key: string): T | null {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The next screen copes without the note.
    }
  },
  clear(key: string) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  },
};

const never = () => () => undefined;

/**
 * Reads a note left in this browser tab. While the page is still being prepared the answer is
 * `undefined` (not known yet); after that it is the note, or null when there is none.
 */
export function useTabNote<T>(key: string): T | null | undefined {
  const raw = useSyncExternalStore(
    never,
    () => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => undefined,
  );
  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [raw]);
}

export const RESET_NOTE = "selestial.reset";
export const RESET_DONE_NOTE = "selestial.reset.done";
