"use client";

import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Notice, QuietButton, SubmitButton } from "@/components/auth/fields";
import { AuthShell, useEvents, type TraceStep } from "@/components/auth/shell";
import { Building2 } from "@/components/icons";
import { AFTER_SIGN_IN, AUTH, invitePath, withNext } from "@/lib/auth/routes";

import { api } from "../../../convex/_generated/api";

/** The key the workspace uses to remember which company is open (src/components/app/gate.tsx). */
const STORED_COMPANY = "selestial.company";

const ROLE_WORDS: Record<string, { name: string; can: string }> = {
  manager: { name: "Manager", can: "Managers run operations and approvals." },
  office: { name: "Office", can: "Office works customers, visits and tasks." },
};

type Outcome = { status: "joined" | "already_member"; companyId: string } | { status: "wrong_account"; emailHint: string } | { status: "unverified" | "expired" | "revoked" | "used" | "not_found" | "limited" };

const ENDED: Record<string, { title: string; body: string }> = {
  expired: { title: "This invitation has expired", body: "Invitations stop working after a while. Ask the person who invited you to send a new one." },
  revoked: { title: "This invitation was withdrawn", body: "The company withdrew this invitation. If you think that is a mistake, ask the person who invited you." },
  accepted: { title: "This invitation was already used", body: "An invitation works once. If you accepted it, sign in to open the workspace." },
  used: { title: "This invitation was already used", body: "It was accepted by a different account. If that was not you, tell the person who invited you." },
  not_found: { title: "This invitation link is not valid", body: "It may have been copied incompletely, or replaced by a newer invitation. Ask the person who invited you to send it again." },
};

export function InviteScreen({ token }: { token: string }) {
  const router = useRouter();
  const here = invitePath(token);
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading: recordLoading, isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const preview = useQuery(api.invitations.preview, { token });
  const accept = useMutation(api.invitations.accept);
  const { events, note } = useEvents();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failed, setFailed] = useState(false);

  const signedIn = isLoaded && isSignedIn;
  const state = outcome && outcome.status !== "joined" && outcome.status !== "already_member" && outcome.status !== "wrong_account" && outcome.status !== "unverified" && outcome.status !== "limited" ? outcome.status : (preview?.state ?? null);
  const joined = outcome?.status === "joined" || outcome?.status === "already_member";

  async function join() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    note("Checking the invitation against your account");
    try {
      const result = (await accept({ token })) as Outcome;
      setOutcome(result);
      if (result.status === "joined" || result.status === "already_member") {
        note(result.status === "joined" ? "You joined the company" : "You were already a member");
        try {
          window.localStorage.setItem(STORED_COMPANY, result.companyId);
        } catch {
          // The workspace opens on the first company instead.
        }
        router.replace(AFTER_SIGN_IN);
        return;
      }
      note("Invitation not accepted");
    } catch {
      setFailed(true);
      note("Could not reach the workspace record");
    }
    setBusy(false);
  }

  const steps: TraceStep[] = [
    { key: "check", label: "Check the invitation", detail: "The link is checked on the server: who it is for, which company, which role, and whether it still stands.", state: preview === undefined ? "active" : state === "pending" || joined ? "done" : "failed" },
    { key: "account", label: "Sign in as the invited person", detail: "Only the email address the invitation was sent to can accept it.", state: state !== "pending" && !joined ? "todo" : joined ? "done" : !signedIn ? "needs_you" : outcome?.status === "wrong_account" || outcome?.status === "unverified" ? "failed" : "done" },
    { key: "join", label: "Join the company", detail: "You get the role on the invitation, and nothing more.", state: joined ? "done" : busy ? "active" : state === "pending" && signedIn && !outcome ? "needs_you" : "todo" },
    { key: "workspace", label: "Open the workspace", detail: "You land in that company.", state: joined ? "active" : "todo" },
  ];

  if (preview === undefined || !isLoaded) {
    return (
      <AuthShell eyebrow="Invitation" title="Checking your invitation" steps={steps} events={events}>
        <p className="text-sm text-[#667085]" role="status">
          One moment.
        </p>
      </AuthShell>
    );
  }

  if (state && state !== "pending") {
    const ended = ENDED[state] ?? ENDED.not_found;
    return (
      <AuthShell eyebrow="Invitation" title={ended.title} lead={ended.body} steps={steps} events={events}>
        <div className="grid gap-3">
          {preview.companyName ? (
            <p className="rounded-xl border border-[#e4e7ef] bg-[#f8f9fc] px-3.5 py-3 text-sm text-[#667085]">
              Invitation to <span className="font-semibold text-[#211a35]">{preview.companyName}</span>
            </p>
          ) : null}
          <QuietButton onClick={() => router.push(signedIn ? AFTER_SIGN_IN : AUTH.login)}>{signedIn ? "Go to my workspace" : "Sign in"}</QuietButton>
        </div>
      </AuthShell>
    );
  }

  const role = ROLE_WORDS[preview.role ?? ""] ?? { name: "Member", can: "" };
  const expires = preview.expiresAt ? new Date(preview.expiresAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : null;
  const summary = (
    <div className="rounded-2xl border border-[#e4e7ef] bg-[#f8f9fc] p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eee8ff] text-[#5126c7]">
          <Building2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-[#211a35]">{preview.companyName}</p>
          <p className="text-sm text-[#667085]">
            Role: <span className="font-medium text-[#211a35]">{role.name}</span>
          </p>
        </div>
      </div>
      {role.can ? <p className="mt-3 text-xs leading-relaxed text-[#667085]">{role.can}</p> : null}
      <dl className="mt-3 grid gap-1 border-t border-[#e4e7ef] pt-3 text-xs text-[#667085]">
        <div className="flex justify-between gap-3">
          <dt>Sent to</dt>
          <dd className="font-medium text-[#211a35]">{preview.emailHint}</dd>
        </div>
        {expires ? (
          <div className="flex justify-between gap-3">
            <dt>Works until</dt>
            <dd className="font-medium text-[#211a35]">{expires}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );

  if (!signedIn) {
    return (
      <AuthShell eyebrow="Invitation" title={`Join ${preview.companyName}`} lead="You have been invited to this company’s Selestial workspace. Sign in or create an account with the email address the invitation was sent to." steps={steps} events={events}>
        <div className="grid gap-4">
          {summary}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              router.push(withNext(AUTH.signup, here));
            }}
          >
            <SubmitButton busy={false} busyLabel="Opening">
              Create an account
            </SubmitButton>
          </form>
          <QuietButton onClick={() => router.push(withNext(AUTH.login, here))}>I already have an account</QuietButton>
        </div>
      </AuthShell>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? "your account";
  const switchAccount = () => void signOut({ redirectUrl: withNext(AUTH.login, here) });
  return (
    <AuthShell eyebrow="Invitation" title={`Join ${preview.companyName}`} lead={<>You are signed in as <span className="font-semibold text-[#211a35]">{email}</span>.</>} steps={steps} events={events}>
      <div className="grid gap-4">
        {summary}
        {outcome?.status === "wrong_account" ? (
          <Notice tone="error" title="This invitation is for a different email">
            It was sent to {outcome.emailHint}, and you are signed in as {email}. Sign in with the invited address to accept it.
          </Notice>
        ) : null}
        {outcome?.status === "unverified" ? <Notice tone="error">Your email address is not confirmed yet, so the invitation cannot be accepted. Confirm it, then come back to this link.</Notice> : null}
        {outcome?.status === "limited" ? <Notice tone="error">Too many attempts in a short time. Wait a few minutes and try again.</Notice> : null}
        {failed ? <Notice tone="error">Could not reach the workspace record. Check your connection and try again.</Notice> : null}
        {!recordLoading && !isAuthenticated ? <Notice tone="error">You are signed in, but the workspace record has not accepted your session yet. Reload the page; if it keeps happening, sign out and in again.</Notice> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <SubmitButton busy={busy} busyLabel="Joining" disabled={recordLoading || !isAuthenticated || outcome?.status === "wrong_account"}>
            Accept invitation
          </SubmitButton>
        </form>
        <QuietButton onClick={switchAccount}>Use a different account</QuietButton>
      </div>
    </AuthShell>
  );
}
