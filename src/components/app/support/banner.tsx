"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";

import { Field, FormError, TextArea, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { SecondFactor } from "@/components/app/support/verify";
import { Eye, Lock, ShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type SupportSession = NonNullable<FunctionReturnType<typeof api.support.session>>;

const ROLE_WORDS = { owner: "Owner", manager: "Manager", office: "Office" } as const;

/** Minutes left, recounted every fifteen seconds so the banner never claims time that has passed. */
function useMinutesLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((until - now) / 60_000));
}

type Dialog = null | "manage" | "extend" | "reveal" | "exit";

/**
 * The bar on every screen of an Admin Support Session: whose workspace this is, View or Manage, how long
 * is left, and the ways out. It never decides what is allowed: the server checks every request.
 */
export function SupportBanner({ session, onExit }: { session: SupportSession; onExit: () => void }) {
  const sessionId = session.id as Id<"supportSessions">;
  const minutes = useMinutesLeft(session.expiresAt);
  const revealMinutes = useMinutesLeft(session.revealedUntil ?? 0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const manage = session.mode === "manage";
  const toView = useMutation(api.support.switchToView);
  const exit = useMutation(api.support.exit);
  const { busy, error, run } = useRun();
  return (
    <div role="region" aria-label="Admin support session" className={cn("sticky top-14 z-10 border-b-2 bg-strong px-3 py-2 text-sm text-card sm:px-6", manage ? "border-warning" : "border-brand-500")}>
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-1.5">
        <p className="flex min-w-0 items-center gap-2">
          <ShieldCheck aria-hidden className={cn("size-4 shrink-0", manage ? "text-warning" : "text-brand-400")} />
          <span className="font-semibold whitespace-nowrap">
            <span className="sm:hidden">Support</span>
            <span className="hidden sm:inline">Admin support session</span>
          </span>
          <span aria-hidden className="opacity-40">·</span>
          <span className="truncate">{session.companyName}</span>
          <span aria-hidden className="opacity-40">·</span>
          <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap", manage ? "bg-warning text-strong" : "bg-card/15")}>{manage ? "Manage" : "View only"}</span>
          {session.previewRole !== "owner" ? <span className="text-xs opacity-75">Seeing what {ROLE_WORDS[session.previewRole]} sees</span> : null}
        </p>
        <p className="text-xs opacity-75" aria-live="polite">
          {minutes > 0 ? `Session expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` : "Session has expired."}
          {revealMinutes > 0 ? ` Message content shown for ${revealMinutes} more ${revealMinutes === 1 ? "minute" : "minutes"}.` : ""}
          {manage && !session.manageHolds ? " Manage access has ended: switch back to View." : ""}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {manage ? (
            <Button size="xs" variant="outline" className="border-card/30 bg-transparent text-card hover:bg-card/10" loading={busy} onClick={() => void run(() => toView({ sessionId }))}>
              Switch to View
            </Button>
          ) : (
            <Button size="xs" variant="outline" className="border-card/30 bg-transparent text-card hover:bg-card/10" onClick={() => setDialog("manage")}>
              <Lock aria-hidden className="size-3.5" />
              <span className="sm:hidden">Manage</span>
              <span className="hidden sm:inline">Switch to Manage</span>
            </Button>
          )}
          {revealMinutes === 0 ? (
            <Button size="xs" variant="ghost" className="text-card hover:bg-card/10" onClick={() => setDialog("reveal")}>
              <Eye aria-hidden className="size-3.5" />
              Reveal<span className="hidden sm:inline"> content</span>
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" className="text-card hover:bg-card/10" onClick={() => setDialog("extend")}>
            Extend
          </Button>
          <Button size="xs" variant="primary" loading={busy} onClick={() => void run(async () => (await exit({ sessionId }), onExit()))}>
            Exit<span className="hidden sm:inline"> session</span>
          </Button>
        </div>
      </div>
      <FormError message={error} />
      <ManageDialog open={dialog === "manage"} session={session} onClose={() => setDialog(null)} />
      <ReasonDialog
        open={dialog === "reveal"}
        onClose={() => setDialog(null)}
        title="Reveal message content"
        description="Customer, cleaner and applicant messages are hidden in support sessions. Revealing shows them for 15 minutes. The company sees your reason in its Support access history."
        reasonLabel="Why do you need to read message content?"
        action="Reveal for 15 minutes"
        submit={(reason) => ({ fn: api.support.reveal, args: { sessionId, reason } })}
      />
      <ReasonDialog open={dialog === "extend"} onClose={() => setDialog(null)} title="Extend the session" description="Adds an hour from now." action="Extend by an hour" submit={() => ({ fn: api.support.extend, args: { sessionId } })} />
    </div>
  );
}

function ManageDialog({ open, session, onClose }: { open: boolean; session: SupportSession; onClose: () => void }) {
  const basis = session.manageBasis;
  return (
    <ReasonDialog
      open={open}
      onClose={onClose}
      title="Switch to Manage"
      description={
        basis === "owner_grant"
          ? "The owner has allowed Selestial Support to make changes. They are told now, and get a summary of what you changed when you finish."
          : basis === "incident"
            ? `Allowed by the open incident “${session.incident?.title ?? ""}”. The owner is told now, and gets a summary of what you changed when you finish.`
            : "Manage needs the owner's permission (their Settings › Support access) or an open incident for this company. Neither is in place, so this will be refused."
      }
      notes={[
        "Only changes opened to support sessions work: correcting settings and drafts, pausing agents, retrying failed work, working tasks.",
        "Sending messages, publishing prices, changing agent authority, buying numbers, billing and approvals stay with the company.",
      ]}
      reasonLabel="What do you need to change?"
      action="Switch to Manage"
      submit={(reason) => ({ fn: api.support.switchToManage, args: { sessionId: session.id as Id<"supportSessions">, reason } })}
    />
  );
}

type Submit = { fn: typeof api.support.reveal | typeof api.support.switchToManage; args: { sessionId: Id<"supportSessions">; reason: string } } | { fn: typeof api.support.extend; args: { sessionId: Id<"supportSessions"> } };

/** A reason (when one is asked for), then a fresh second factor, then the change. */
function ReasonDialog({ open, onClose, title, description, notes, reasonLabel, action, submit }: { open: boolean; onClose: () => void; title: string; description: string; notes?: string[]; reasonLabel?: string; action: string; submit: (reason: string) => Submit }) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <ReasonForm notes={notes} reasonLabel={reasonLabel} action={action} submit={submit} onDone={onClose} />
    </Modal>
  );
}

function ReasonForm({ notes, reasonLabel, action, submit, onDone }: { notes?: string[]; reasonLabel?: string; action: string; submit: (reason: string) => Submit; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const call = useMutation(submit(reason).fn as typeof api.support.reveal);
  const { busy, error, run } = useRun();
  const ready = !reasonLabel || reason.trim().length >= 10;
  return (
    <div className="grid gap-4">
      {notes ? (
        <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {reasonLabel ? (
        <Field label={reasonLabel} hint="At least a few words. The company sees this.">
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </Field>
      ) : null}
      <FormError message={error} />
      {ready ? (
        <SecondFactor
          label={action}
          busy={busy}
          onVerified={() =>
            void run(async () => {
              const { args } = submit(reason.trim());
              await call(args as { sessionId: Id<"supportSessions">; reason: string });
              onDone();
            })
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">Give a reason to continue.</p>
      )}
    </div>
  );
}
