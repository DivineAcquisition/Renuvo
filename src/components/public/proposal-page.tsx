"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { Action, Card, Loading, Notice, Problem, problemWords } from "@/components/cleaner/shell";

import { api } from "../../../convex/_generated/api";
import { ProposalDocument, type ProposalDoc } from "./proposal-document";
import { Checkbox } from "@/components/ui/selection";

type Mode = null | "accept" | "changes" | "decline";

/**
 * The client's proposal: read it, then accept, ask for changes or decline. Reading the link doesn't give
 * authority: accepting asks who is accepting and whether they may, and lets them name another signer.
 * Accepting is followed by an agreement to sign; nothing is booked or charged on this page.
 */
export function ProposalPage({ token }: { token: string }) {
  const view = useQuery(api.proposals.publicView, { token });
  const viewed = useMutation(api.proposals.viewed);
  const respond = useMutation(api.proposals.respond);
  const [mode, setMode] = useState<Mode>(null);
  const [option, setOption] = useState("");
  const [form, setForm] = useState({ name: "", email: "", title: "", note: "", authorized: false, other: false, signerName: "", signerEmail: "", signerTitle: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const noted = useRef(false);
  useEffect(() => {
    if (!view || noted.current) return;
    noted.current = true;
    void viewed({ token }).catch(() => undefined);
  }, [view, viewed, token]);

  if (view === undefined) return <Loading what="the proposal" />;
  if (view === null)
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Notice tone="bad" title="This link doesn't work">
          Check the link in your email, or ask the company to send it again.
        </Notice>
      </main>
    );

  const open = view.status === "sent" || view.status === "changes_requested";
  const submit = () => {
    if (!mode) return;
    setProblem(null);
    setBusy(true);
    respond({
      token,
      version: view.version,
      hash: view.hash,
      kind: mode,
      ...(option ? { optionId: option } : {}),
      name: form.name,
      ...(form.email ? { email: form.email } : {}),
      ...(form.title ? { title: form.title } : {}),
      authorized: mode === "accept" ? form.authorized || form.other : false,
      ...(mode === "accept" && form.other ? { signer: { name: form.signerName, email: form.signerEmail, ...(form.signerTitle ? { title: form.signerTitle } : {}) } } : {}),
      ...(form.note ? { note: form.note } : {}),
    })
      .then(() => setMode(null))
      .catch((caught: unknown) => setProblem(problemWords(caught)))
      .finally(() => setBusy(false));
  };
  const input = "min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-6 pb-28 print:max-w-none print:p-0">
      {view.status === "accepted" ? (
        <Notice tone="good" title="Accepted">
          Thank you. {view.company} will send the service agreement to sign next, then confirm billing and the start date for each site. Accepting didn&apos;t book or charge anything.
        </Notice>
      ) : null}
      {view.status === "changes_requested" ? <Notice tone="warn" title="Changes requested">{view.company} has your note and will send an updated version. You can still accept this one.</Notice> : null}
      {view.status === "declined" ? <Notice tone="neutral" title="Declined">You declined this proposal. Contact {view.company} if that changes.</Notice> : null}
      {view.status === "expired" ? <Notice tone="bad" title="This proposal has expired">Ask {view.company} for a new one.</Notice> : null}
      {view.status === "withdrawn" || view.status === "superseded" ? <Notice tone="bad" title="This proposal is no longer open">{view.company} withdrew it.</Notice> : null}

      <ProposalDocument doc={view.content as unknown as ProposalDoc} company={view.company} version={view.version} expiresAt={view.expiresAt} selectedOption={option} onSelectOption={open ? setOption : undefined} />

      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded-xl border border-border px-4 py-2 text-sm">
          Print or save as PDF
        </button>
      </div>

      {open ? (
        <Card title="Your answer" className="print:hidden">
          <div role="radiogroup" aria-label="Your answer" className="grid gap-2 sm:grid-cols-3">
            {(["accept", "changes", "decline"] as const).map((kind) => (
              <label key={kind} className={`cursor-pointer rounded-xl border p-3 text-sm font-medium ${mode === kind ? "border-brand-500 bg-brand-500/8" : "border-border"}`}>
                <input type="radio" className="sr-only" name="answer" checked={mode === kind} onChange={() => setMode(kind)} />
                {kind === "accept" ? "Accept" : kind === "changes" ? "Ask for changes" : "Decline"}
              </label>
            ))}
          </div>
          {mode ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Your name</span>
                  <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Your email</span>
                  <input className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Your title</span>
                  <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
              </div>
              {mode === "accept" ? (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-1" checked={form.authorized} onCheckedChange={(checked) => setForm({ ...form, authorized: checked, other: checked ? false : form.other })} />
                    <span>I&apos;m authorized to accept this proposal for {view.content.client.name}.</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-1" checked={form.other} onCheckedChange={(checked) => setForm({ ...form, other: checked, authorized: checked ? false : form.authorized })} />
                    <span>Someone else signs our contracts. They&apos;ll get the agreement to sign; the agreement stays with {view.content.client.name}.</span>
                  </label>
                  {form.other ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <input className={input} aria-label="Signer's name" placeholder="Signer's name" value={form.signerName} onChange={(e) => setForm({ ...form, signerName: e.target.value })} />
                      <input className={input} aria-label="Signer's email" placeholder="Signer's email" type="email" value={form.signerEmail} onChange={(e) => setForm({ ...form, signerEmail: e.target.value })} />
                      <input className={input} aria-label="Signer's title" placeholder="Signer's title" value={form.signerTitle} onChange={(e) => setForm({ ...form, signerTitle: e.target.value })} />
                    </div>
                  ) : null}
                </>
              ) : (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{mode === "changes" ? "What would you like changed?" : "Anything you'd like to tell us? (optional)"}</span>
                  <textarea className="min-h-24 rounded-xl border border-border bg-background px-3 py-2 text-base" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
              )}
              <Problem message={problem} />
              <Action busy={busy} disabled={form.name.trim().length < 2 || (mode === "accept" && !form.authorized && !form.other)} onPress={submit}>
                {mode === "accept" ? `Accept version ${view.version}` : mode === "changes" ? "Send my changes" : "Decline"}
              </Action>
              {mode === "accept" ? <p className="text-xs text-muted-foreground">Accepting records your name and the exact version you read. Payment and the start date are set up after the agreement is signed.</p> : null}
            </div>
          ) : null}
        </Card>
      ) : null}
    </main>
  );
}
