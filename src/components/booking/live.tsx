"use client";

/**
 * The public booking page. Before a visitor starts, it draws the published page; the ZIP code starts a
 * session through Selestial's server and the private token comes back once. The token is kept only in
 * this browser, under this company and experience, and in a link's fragment, never in a query string.
 */
import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { convexUrl } from "@/lib/app/config";

import { api } from "../../../convex/_generated/api";
import { signBookingAgreement, startBooking, type Attribution } from "../../app/b/actions";
import { BookingSurface, useSessionActions } from "./renderer";

let client: ConvexReactClient | null = null;

export function BookingProviders({ children }: { children: ReactNode }) {
  const url = convexUrl();
  if (!url) return <Unavailable title="Online booking isn't set up yet" body="Please contact the company directly." />;
  client ??= new ConvexReactClient(url);
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

export function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-white px-4 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-600">{body}</p>
      </div>
    </main>
  );
}

const storageKey = (handle: string, slug: string) => `selestial.booking.v1.${handle}.${slug}`;
const RESUME_KEY = "selestial.booking.resume";
const WEEK = 7 * 24 * 60 * 60 * 1000;

// ── Where this browser keeps a private token: one small store everything subscribes to. ─────────

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener("hashchange", listener);
  };
}

function hashToken(): string | null {
  return window.location.hash.startsWith("#bk_") ? window.location.hash.slice(1) : null;
}

function readToken(key: string, store: "local" | "session" = "local"): string | null {
  try {
    const raw = (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { token?: string; at?: number };
    if (!saved.token || !saved.at || Date.now() - saved.at > WEEK) return null;
    return saved.token;
  } catch {
    return null;
  }
}

function writeToken(key: string, token: string | null, store: "local" | "session" = "local") {
  try {
    const s = store === "local" ? window.localStorage : window.sessionStorage;
    if (token) s.setItem(key, JSON.stringify({ token, at: Date.now() }));
    else s.removeItem(key);
  } catch {
    /* Private browsing: the session still works until the tab closes. */
  }
  notify();
}

/** The token for this page: from a link's fragment, or saved in this browser. Undefined while rendering on the server. */
function useToken(key: string, store: "local" | "session"): string | null | undefined {
  const token = useSyncExternalStore(
    subscribe,
    () => hashToken() ?? readToken(key, store),
    () => undefined,
  );
  // A token that arrived in the fragment is kept in this browser, and the fragment is cleared from the address bar.
  useEffect(() => {
    const fromHash = hashToken();
    if (!fromHash) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    writeToken(key, fromHash, store);
  }, [key, store, token]);
  return token;
}

/** Where the visitor came from: campaign words and the referring site only. Anything else in the address is dropped. */
function attributionNow(): Attribution {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("utm_source") ?? params.get("source") ?? "",
    medium: params.get("utm_medium") ?? "",
    campaign: params.get("utm_campaign") ?? params.get("campaign") ?? "",
    referrer: document.referrer,
    landing: window.location.pathname,
  };
}

export function LiveBooking({ handle, slug }: { handle: string; slug: string }) {
  const page = useQuery(api.bookingPublic.page, { handle, slug });
  const key = storageKey(handle, slug);
  const token = useToken(key, "local");
  const view = useQuery(api.bookingSessions.view, token ? { token } : "skip");
  // A link that has ended is forgotten, so the visitor can start again.
  useEffect(() => {
    if (view?.ended) writeToken(key, null);
  }, [view, key]);

  const server = useMemo(
    () => ({
      start: async (postalCode: string) => {
        const r = await startBooking({ handle, slug, postalCode, attribution: attributionNow() });
        if (r.ok) {
          writeToken(key, r.token);
          return { ok: true as const };
        }
        return r;
      },
      sign: signBookingAgreement,
    }),
    [handle, slug, key],
  );
  const actions = useSessionActions(token ?? null, server);

  if (page === undefined || token === undefined || (token && view === undefined)) return <Loading />;
  if (page === null) return <Unavailable title="This booking page isn't available" body="It may have moved or closed. Please contact the company directly." />;
  const live = view && !view.ended ? view : null;
  return <BookingSurface key={token ?? "new"} def={live?.definition ?? page.definition} company={live?.company ?? page.company} heroUrl={live?.heroUrl ?? page.heroUrl} token={live ? token : null} view={live} actions={actions} className="min-h-screen" />;
}

/** A link from an email: the token is in the fragment, which never reaches a server or a referrer. */
export function ResumeBooking() {
  const token = useToken(RESUME_KEY, "session");
  const view = useQuery(api.bookingSessions.view, token ? { token } : "skip");
  const server = useMemo(() => ({ start: async () => ({ ok: false as const, why: "Open the company's booking page to start a new booking." }), sign: signBookingAgreement }), []);
  const actions = useSessionActions(token ?? null, server);
  if (token === undefined || (token && view === undefined)) return <Loading />;
  if (!token || !view || view.ended) return <Unavailable title="This booking link has ended" body={view?.ended && view.company ? `Please contact ${view.company} for a new link.` : "Please contact the company for a new link."} />;
  return <BookingSurface def={view.definition} company={view.company} heroUrl={view.heroUrl} token={token} view={view} actions={actions} className="min-h-screen" />;
}

function Loading() {
  return (
    <main className="min-h-screen bg-white" aria-busy="true">
      <div className="h-[92px] border-b border-zinc-100" />
      <div className="mx-auto mt-12 max-w-xl space-y-4 px-4">
        <div className="mx-auto h-8 w-2/3 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none" />
        <div className="mx-auto h-4 w-1/2 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none" />
        <div className="h-48 animate-pulse rounded-2xl bg-zinc-100 motion-reduce:animate-none" />
      </div>
      <p className="sr-only">Loading the booking page…</p>
    </main>
  );
}
