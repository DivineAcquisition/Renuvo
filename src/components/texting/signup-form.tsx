"use client";

import { useState } from "react";

import { signUpForTexts } from "@/app/b/actions";

import { Linked } from "./legal-page";

/**
 * A company's texting sign-up. Both boxes start unchecked and are optional, the text box is labelled for
 * texts only and is separate from any other terms, and marketing has its own box. What the person checked
 * is recorded with the exact wording shown (the page version).
 */
export function SignupForm(props: { handle: string; version: number; company: string; consent: string; marketing: string | null; links: { privacy: string; terms: string }; preview?: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [texts, setTexts] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "done"; words: string } | { kind: "error"; words: string }>({ kind: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (props.preview) return;
    setState({ kind: "sending" });
    const result = await signUpForTexts({ handle: props.handle, version: props.version, name, phone, texts, marketing });
    setState(result.ok ? { kind: "done", words: result.words } : { kind: "error", words: result.why });
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        {state.words}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium text-zinc-900">Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-[15px] text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10" />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium text-zinc-900">Mobile number</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="(512) 555-0142" required className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-[15px] text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10" />
      </label>
      <label className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm leading-6">
        <input type="checkbox" checked={texts} onChange={(e) => setTexts(e.target.checked)} className="mt-1 size-4 shrink-0 accent-zinc-900" />
        <span>
          <span className="block font-medium text-zinc-900">Text messages (optional)</span>
          <Linked text={props.consent} />
        </span>
      </label>
      {props.marketing ? (
        <label className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm leading-6">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-1 size-4 shrink-0 accent-zinc-900" />
          <span>
            <span className="block font-medium text-zinc-900">Offers by text (optional)</span>
            {props.marketing}
          </span>
        </label>
      ) : null}
      <p className="text-xs leading-5 text-zinc-500">
        <a href={props.links.terms} className="underline underline-offset-2">
          Texting Terms
        </a>{" "}
        ·{" "}
        <a href={props.links.privacy} className="underline underline-offset-2">
          Privacy Policy
        </a>
        . {props.company} doesn&apos;t sell or share your mobile number for marketing.
      </p>
      {state.kind === "error" ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.words}
        </p>
      ) : null}
      <button type="submit" disabled={state.kind === "sending" || props.preview} className="h-11 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60">
        {state.kind === "sending" ? "Saving…" : "Save my choice"}
      </button>
    </form>
  );
}
