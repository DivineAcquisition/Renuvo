"use client";

import { useEffect, useRef, useState } from "react";

import { closeWithoutChoosing, OPEN, openPreferences, saveChoice, useConsent } from "@/components/consent/store";
import { X } from "@/components/icons";
import { allowed } from "@/lib/consent/model";
import type { TrackingTool } from "@/lib/consent/tools";
import { cn } from "@/lib/utils";

const button = "inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]";
const quiet = cn(button, "border-[#d5dae5] bg-white text-[#211a35] hover:bg-[#f8f9fc]");

/**
 * The cookie banner and the preferences dialog. Accepting and rejecting are equally easy: same size,
 * same weight, side by side. Closing is not accepting. The dialog can always be reopened from the
 * footer's "Cookie preferences".
 */
export function ConsentControls({ tools }: { tools: TrackingTool[] }) {
  const snap = useConsent();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const configured = tools.filter((tool) => tool.id);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);

  const save = (analytics: boolean, advertising: boolean) => {
    const ok = saveChoice(analytics, advertising);
    setFailed(!ok);
    if (ok) setOpen(false);
  };

  // With no optional tool set up there is nothing to ask about; the footer link still explains that.
  const showBanner = snap.ready && configured.length > 0 && !snap.current && !snap.closed && !open;

  return (
    <>
      {showBanner ? (
        <section role="region" aria-label="Cookie choices" className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-3xl rounded-2xl border border-[#e4e7ef] bg-white p-4 text-[#211a35] shadow-[0_24px_60px_-24px_rgba(33,26,53,0.45)] sm:p-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Your choice on cookies</h2>
              <p className="mt-1 text-sm leading-relaxed text-[#667085]">
                Essential cookies keep this site working. With your permission we also use analytics{configured.some((tool) => tool.category === "advertising") ? " and advertising" : ""} tools. Nothing optional runs until you choose.{" "}
                <a href="/cookies" className="font-medium text-[#5126c7] underline-offset-4 hover:underline">
                  Cookies and tracking
                </a>
              </p>
              {snap.gpc ? <p className="mt-1 text-xs text-[#3f1d9e]">Your browser sent a Global Privacy Control signal. We treat it as opting out: advertising stays off.</p> : null}
            </div>
            <button type="button" onClick={closeWithoutChoosing} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#667085] hover:bg-[#f1f3f8] focus-visible:outline-2 focus-visible:outline-[#6838ef]">
              <X className="size-4" aria-hidden />
              <span className="sr-only">Close without choosing. Optional cookies stay off.</span>
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button type="button" className={quiet} onClick={() => save(true, true)}>
              Accept optional
            </button>
            <button type="button" className={quiet} onClick={() => save(false, false)}>
              Reject optional
            </button>
            <button type="button" className={quiet} onClick={openPreferences}>
              Manage preferences
            </button>
          </div>
          {failed ? (
            <p role="alert" className="mt-2 text-xs text-red-700">
              This browser did not let us save your choice. Optional cookies stay off.
            </p>
          ) : null}
        </section>
      ) : null}
      {open ? <Preferences tools={tools} onClose={() => setOpen(false)} onSave={save} failed={failed} /> : null}
    </>
  );
}

function Preferences({ tools, onClose, onSave, failed }: { tools: TrackingTool[]; onClose: () => void; onSave: (analytics: boolean, advertising: boolean) => void; failed: boolean }) {
  const snap = useConsent();
  const now = Date.now();
  const [analytics, setAnalytics] = useState(() => allowed("analytics", snap.choice, snap.gpc, now));
  const [advertising, setAdvertising] = useState(() => allowed("advertising", snap.choice, snap.gpc, now));
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>("input:not([disabled]), button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button, input:not([disabled]), a[href]")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const group = (category: "analytics" | "advertising") => tools.filter((tool) => tool.category === category);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#211a35]/50 p-3 sm:items-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="consent-title" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e4e7ef] bg-white p-5 text-[#211a35] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="consent-title" className="font-heading text-xl tracking-tight">
            Cookie preferences
          </h2>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-[#667085] hover:bg-[#f1f3f8] focus-visible:outline-2 focus-visible:outline-[#6838ef]">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close without saving</span>
          </button>
        </div>
        <p className="mt-1 text-sm text-[#667085]">Your choice applies to this browser and lasts twelve months, or until you change it here.</p>
        {snap.gpc ? <p className="mt-3 rounded-xl border border-[#d9cfff] bg-[#eee8ff] px-3 py-2 text-sm text-[#3f1d9e]">Your browser sent a Global Privacy Control signal. Advertising stays off. You can still turn analytics on yourself.</p> : null}
        <Category title="Essential" body="Keep the site working and remember this choice. Always on." checked locked tools={[]} />
        <Category title="Analytics" body="Help us see which pages are read." checked={analytics} onChange={setAnalytics} tools={group("analytics")} />
        <Category title="Advertising" body="Measure whether our ads lead to visits and sign-ups." checked={advertising && !snap.gpc} onChange={setAdvertising} locked={snap.gpc} lockedNote={snap.gpc ? "Off because of your Global Privacy Control signal." : undefined} tools={group("advertising")} />
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <button type="button" className={cn(button, "icon-gradient border-[#5126c7]/40")} onClick={() => onSave(analytics, advertising && !snap.gpc)}>
            Save choices
          </button>
          <button type="button" className={quiet} onClick={() => onSave(true, !snap.gpc)}>
            Accept optional
          </button>
          <button type="button" className={quiet} onClick={() => onSave(false, false)}>
            Reject optional
          </button>
        </div>
        {failed ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            This browser did not let us save your choice. Optional cookies stay off.
          </p>
        ) : null}
        <p className="mt-4 text-xs text-[#667085]">
          Full details: <a href="/cookies" className="font-medium text-[#5126c7] underline-offset-4 hover:underline">Cookies and tracking</a>
        </p>
      </div>
    </div>
  );
}

function Category({ title, body, checked, onChange, locked, lockedNote, tools }: { title: string; body: string; checked: boolean; onChange?: (value: boolean) => void; locked?: boolean; lockedNote?: string; tools: TrackingTool[] }) {
  const id = `consent-${title.toLowerCase()}`;
  const configured = tools.filter((tool) => tool.id);
  return (
    <div className="mt-4 rounded-xl border border-[#e4e7ef] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-sm text-[#667085]">{body}</span>
        </label>
        <input id={id} type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={locked} onChange={(event) => onChange?.(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[#6838ef]" />
      </div>
      {lockedNote ? <p className="mt-1 text-xs text-[#3f1d9e]">{lockedNote}</p> : null}
      {tools.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-xs text-[#667085]">
          {tools.map((tool) => (
            <li key={tool.key}>
              <span className="font-medium text-[#211a35]">{tool.name}</span> ({tool.company}){tool.id ? "" : " — not in use on this site"}
            </li>
          ))}
        </ul>
      ) : null}
      {tools.length > 0 && configured.length === 0 ? <p className="mt-1 text-xs text-[#667085]">None of these is in use on this site right now.</p> : null}
    </div>
  );
}

/** The footer link that reopens the choices at any time. */
export function CookiePreferencesLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openPreferences} className={className}>
      Cookie preferences
    </button>
  );
}
