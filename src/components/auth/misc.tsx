"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice, QuietButton } from "@/components/auth/fields";
import { SETUP_PROBLEM, useNext } from "@/components/auth/flow";
import { AuthLink, AuthShell, useEvents, type TraceStep } from "@/components/auth/shell";
import { AFTER_SIGN_IN, AUTH, withNext } from "@/lib/auth/routes";

/**
 * Where every sign-in ends up. It waits until the session is confirmed, then sends the person to the
 * checked destination, or to the workspace. Signed out, it sends them to sign in, keeping the destination.
 */
export function CallbackScreen() {
  const router = useRouter();
  const next = useNext();
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const { events, note } = useEvents();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // A session that exists but is held back by a step of the sign-in service's own is a setup gap.
      router.replace(clerk.session?.currentTask ? SETUP_PROBLEM : withNext(AUTH.login, next));
      return;
    }
    note("Session confirmed");
    router.replace(next ?? AFTER_SIGN_IN);
  }, [clerk, isLoaded, isSignedIn, next, note, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  const steps: TraceStep[] = [
    { key: "credentials", label: "Check who you are", detail: "Done on the last screen.", state: "done" },
    { key: "session", label: "Confirm your session", detail: "Nothing opens until the session is confirmed as yours.", state: isLoaded && isSignedIn ? "done" : "active" },
    { key: "workspace", label: next?.startsWith(AUTH.invite) ? "Return to your invitation" : "Open your workspace", detail: "You land in your company, or in setup if you do not have one yet.", state: isLoaded && isSignedIn ? "active" : "todo" },
  ];
  return (
    <AuthShell eyebrow="Signing in" title="Opening your workspace" lead="This takes a moment." steps={steps} events={events}>
      <div className="grid gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-[#e4e7ef] bg-[#f8f9fc] px-3.5 py-3 text-sm text-[#667085]" role="status" aria-live="polite">
          <span className="auth-dot relative size-2 shrink-0 rounded-full bg-[#6838ef] text-[#6838ef]" aria-hidden />
          {isLoaded && isSignedIn ? "Session confirmed. Opening." : "Confirming your session."}
        </div>
        {slow ? (
          <Notice tone="info">
            This is taking longer than usual. <AuthLink href={withNext(AUTH.login, next)}>Go to sign in</AuthLink>
          </Notice>
        ) : null}
      </div>
    </AuthShell>
  );
}

const REASONS: Record<string, { title: string; body: string }> = {
  expired: { title: "That link has expired", body: "Links stop working after a while, to keep your account safe. Ask for a new one from the page where you started." },
  invalid: { title: "That link is not valid", body: "It may have been copied incompletely, or it was replaced by a newer one. Ask for a new one from the page where you started." },
  used: { title: "That link was already used", body: "Each link works once. If you have finished what it was for, sign in. Otherwise ask for a new one." },
  session: { title: "Your session ended", body: "For your safety, sessions end after a while. Sign in again to continue." },
  access: { title: "You do not have access to that", body: "You are signed in, but your account is not part of that workspace, or your access was removed. Ask the workspace Owner if you think this is a mistake." },
  setup: { title: "Sign-in is not finished being set up", body: "Something on this deployment still needs configuring before sign-in can work. Nothing is wrong with your account." },
};

/** One page for a link or a session that cannot be used, with a way forward from each. */
export function ErrorScreen() {
  const router = useRouter();
  const reason = useSearchParams().get("reason") ?? "";
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut, session } = useClerk();
  const { events } = useEvents();
  const known = REASONS[reason] ?? { title: "Something went wrong", body: "That did not work, and it is not something you did. Try again from the sign-in page." };
  const steps: TraceStep[] = [
    { key: "open", label: "Open the link or page", detail: "This is where it stopped.", state: "failed" },
    { key: "next", label: "Choose what to do next", detail: "Sign in, or ask for a new link where you started.", state: "needs_you" },
  ];
  return (
    <AuthShell eyebrow="Sign in" title={known.title} lead={known.body} steps={steps} events={events}>
      <div className="grid gap-3">
        {isLoaded && !isSignedIn && session ? (
          <QuietButton onClick={() => void signOut({ redirectUrl: `${AUTH.login}?reason=signed_out` })}>Sign out</QuietButton>
        ) : isLoaded && isSignedIn ? (
          <>
            <QuietButton onClick={() => router.push(AFTER_SIGN_IN)}>Go to my workspace</QuietButton>
            <QuietButton onClick={() => void signOut({ redirectUrl: `${AUTH.login}?reason=signed_out` })}>Sign out</QuietButton>
          </>
        ) : (
          <>
            <QuietButton onClick={() => router.push(AUTH.login)}>Sign in</QuietButton>
            <QuietButton onClick={() => router.push(AUTH.forgot)}>Reset my password</QuietButton>
          </>
        )}
      </div>
    </AuthShell>
  );
}
