"use client";

/**
 * Turning off one kind of Selestial notice from the link in it. One button, so a mail scanner that opens
 * links never unsubscribes anyone by itself. Security and account notices can't be turned off here.
 */
import { useQuery } from "convex/react";
import { useState, useSyncExternalStore } from "react";

import { api } from "../../../convex/_generated/api";
import { unsubscribeFromNotices } from "../../app/n/actions";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function Frame({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F5F4FA] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#E6E3F0] bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold tracking-tight text-[#6838EF]">Selestial</p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-[#211A35]">{title}</h1>
        <div className="mt-3 space-y-4 text-sm text-[#5E6478]">{children}</div>
      </div>
    </main>
  );
}

export function NoticeUnsubscribe() {
  const token = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => undefined);
  const info = useQuery(api.notifications.unsubscribeInfo, token ? { token } : "skip");
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  if (token === undefined || (token && info === undefined)) return <main className="min-h-screen bg-[#F5F4FA]" aria-busy="true" />;
  if (!token || !info) return <Frame title="This link isn't valid"><p>You can choose what Selestial emails you in Settings › Notifications.</p></Frame>;
  if (info.locked) return <Frame title={`${info.label} notices are always sent`}><p>They&apos;re about your account&apos;s security or something only you can fix, so they can&apos;t be turned off.</p></Frame>;
  if (info.off || state === "done") return <Frame title={`${info.label} emails are off`}><p>You won&apos;t get these from {info.company} any more. You can turn them back on in Settings › Notifications.</p></Frame>;
  return (
    <Frame title={`Stop ${info.label.toLowerCase()} emails?`}>
      <p>{info.about}</p>
      <p>This is only for {info.company}. Everything stays visible in Selestial.</p>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const result = await unsubscribeFromNotices({ token });
          setState(result.ok ? "done" : result.why);
        }}
        className="h-11 rounded-xl bg-[#6838EF] px-6 text-sm font-semibold text-white disabled:opacity-60"
      >
        {state === "busy" ? "Turning off…" : "Turn off these emails"}
      </button>
      {state !== "idle" && state !== "busy" && state !== "done" ? (
        <p role="alert" className="text-[#B42318]">
          {state}
        </p>
      ) : null}
    </Frame>
  );
}
