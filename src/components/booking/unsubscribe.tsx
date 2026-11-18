"use client";

/**
 * Taking an address off a company's marketing email, from the link in a "finish your booking" reminder.
 * One button, so a mail scanner that opens links never unsubscribes anyone by itself. Email about the
 * person's own bookings keeps coming.
 */
import { useQuery } from "convex/react";
import { useState, useSyncExternalStore } from "react";

import { api } from "../../../convex/_generated/api";
import { unsubscribeFromBookingEmail } from "../../app/b/actions";
import { Unavailable } from "./live";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function Unsubscribe() {
  const token = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => undefined,
  );
  const info = useQuery(api.bookingPublic.unsubscribeInfo, token ? { token } : "skip");
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  if (token === undefined || (token && info === undefined)) return <main className="min-h-screen bg-white" aria-busy="true" />;
  if (!token || !info) return <Unavailable title="This link isn't valid" body="Please contact the company directly to change the email you get." />;
  if (info.done || state === "done") return <Unavailable title="You're unsubscribed" body={`You won't get marketing email from ${info.company}. Email about your own bookings will still arrive.`} />;
  return (
    <main className="grid min-h-screen place-items-center bg-white px-4 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Stop marketing email from {info.company}?</h1>
        <p className="text-sm text-zinc-600">You&apos;ll still get email about bookings you make.</p>
        <button
          type="button"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            const result = await unsubscribeFromBookingEmail({ token });
            setState(result.ok ? "done" : result.why);
          }}
          className="h-11 rounded-full bg-zinc-900 px-6 text-sm font-medium text-white disabled:opacity-60"
        >
          {state === "busy" ? "Unsubscribing…" : "Unsubscribe"}
        </button>
        {state !== "idle" && state !== "busy" && state !== "done" ? (
          <p role="alert" className="text-sm text-red-700">
            {state}
          </p>
        ) : null}
      </div>
    </main>
  );
}
