"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { Action, Card, Loading, Notice, Page, Problem, problemWords } from "@/components/cleaner/shell";

import { api } from "../../../convex/_generated/api";
import { PlainDoc } from "./plain-doc";

/**
 * Selestial-hosted signing. The signer reads the exact approved version, types their name, agrees and
 * signs. The page shows the version and when it was signed, and prints as the signed copy.
 */
export function SignPage({ token }: { token: string }) {
  const view = useQuery(api.sign.view, { token });
  const opened = useMutation(api.sign.opened);
  const sign = useMutation(api.sign.signNow);
  const decline = useMutation(api.sign.decline);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const noted = useRef(false);

  useEffect(() => {
    if (!view || view.state !== "open" || noted.current) return;
    noted.current = true;
    void opened({ token }).catch(() => undefined);
  }, [view, opened, token]);

  if (view === undefined) return <Loading what="the document" />;
  if (view === null)
    return (
      <Page company={null} title="Link not found">
        <Notice tone="bad" title="This link doesn't work">
          Check the link in your message, or ask the company to send a new one.
        </Notice>
      </Page>
    );

  const run = (work: () => Promise<unknown>) => {
    setProblem(null);
    setBusy(true);
    work()
      .catch((caught: unknown) => setProblem(problemWords(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <Page company={view.company} title={view.title}>
      {view.state === "signed" && "signature" in view && view.signature ? (
        <Notice tone="good" title="Signed">
          {view.signature.typedName} signed version {"version" in view ? view.version : ""} on {new Date(view.signature.at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}. You can print this page as your copy.
        </Notice>
      ) : null}
      {view.state === "declined" ? <Notice tone="warn" title="You declined to sign">The company has been told.</Notice> : null}
      {view.state === "expired" ? <Notice tone="bad" title="This link has expired">Ask the company to send a new one.</Notice> : null}
      {view.state === "withdrawn" || view.state === "closed" ? <Notice tone="bad" title="This document can no longer be signed here">The company withdrew or replaced it.</Notice> : null}
      {"markdown" in view && view.markdown ? (
        <Card className="print:border-0">
          <p className="text-xs text-muted-foreground">
            Version {view.version} · fingerprint {view.hash.slice(0, 12)}
          </p>
          <PlainDoc markdown={view.markdown} />
        </Card>
      ) : null}
      {view.state === "open" && "consent" in view ? (
        <Card title={`Sign as ${view.signer.name}`} className="print:hidden">
          {view.others.length ? <p className="text-xs text-muted-foreground">Also signing: {view.others.map((o) => `${o.name}${o.signed ? " (signed)" : ""}`).join(", ")}</p> : null}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Type your full name</span>
            <input className="min-h-11 rounded-xl border border-border bg-background px-3 text-base" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{view.consent}</span>
          </label>
          <Problem message={problem} />
          <Action busy={busy} disabled={!agreed || name.trim().length < 2} onPress={() => run(() => sign({ token, typedName: name, hash: view.hash, agreed, userAgent: navigator.userAgent }))}>
            Sign
          </Action>
          {declining ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Why are you declining? (optional)</span>
                <textarea className="min-h-20 rounded-xl border border-border bg-background px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <Action kind="secondary" busy={busy} onPress={() => run(() => decline({ token, reason: reason || undefined }))}>
                Decline to sign
              </Action>
            </div>
          ) : (
            <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setDeclining(true)}>
              I don&apos;t want to sign this
            </button>
          )}
        </Card>
      ) : null}
    </Page>
  );
}
