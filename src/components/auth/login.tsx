"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { CodeField, Notice, PasswordField, QuietButton, SubmitButton, TextField, useCooldown } from "@/components/auth/fields";
import { enter, useNext, useSkipWhenSignedIn } from "@/components/auth/flow";
import { AuthLink, AuthShell, useEvents, type TraceStep } from "@/components/auth/shell";
import { problemOf, type AuthProblem } from "@/lib/auth/errors";
import { AUTH, inviteTokenIn, withNext } from "@/lib/auth/routes";

type Stage = "password" | "second";
type SecondFactor = "email_code" | "totp" | "phone_code" | "backup_code";

const REASONS: Record<string, string> = {
  session: "Your session ended. Sign in again to pick up where you left off.",
  signed_out: "You are signed out.",
  password: "Your password was updated. Sign in with the new one.",
};

export function LoginScreen() {
  const router = useRouter();
  const next = useNext();
  const reason = useSearchParams().get("reason");
  const { signIn, fetchStatus } = useSignIn();
  const { events, note } = useEvents();
  const [stage, setStage] = useState<Stage>("password");
  const [factor, setFactor] = useState<SecondFactor>("email_code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const cooldown = useCooldown("selestial.signin.code", 30);
  const alreadyIn = useSkipWhenSignedIn(!busy && !entering, next);
  const invited = inviteTokenIn(next) !== null;

  /** Reads where the sign-in stands and does the next thing. Nothing moves on until the session is real. */
  async function advance() {
    if (!signIn) return;
    if (signIn.status === "complete") {
      note("Password accepted");
      setEntering(true);
      const error = await enter(signIn, router, next);
      if (error) {
        setEntering(false);
        setProblem(problemOf(error));
        note("Session could not be opened");
        return;
      }
      note("Session confirmed");
      return;
    }
    if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
      const offered = signIn.supportedSecondFactors.map((row) => row.strategy as string);
      const pick: SecondFactor | null = offered.includes("email_code") ? "email_code" : offered.includes("totp") ? "totp" : offered.includes("phone_code") ? "phone_code" : offered.includes("backup_code") ? "backup_code" : null;
      if (!pick) {
        setProblem({ message: "This account needs a second step this screen cannot do yet. Contact your workspace owner.", kind: "setup" });
        return;
      }
      setFactor(pick);
      if (pick === "email_code") {
        const { error } = await signIn.mfa.sendEmailCode();
        if (error) return setProblem(problemOf(error));
        cooldown.start();
        note("Code sent to your email");
      } else if (pick === "phone_code") {
        const { error } = await signIn.mfa.sendPhoneCode();
        if (error) return setProblem(problemOf(error));
        cooldown.start();
        note("Code sent to your phone");
      }
      note("Password accepted");
      setCode("");
      setStage("second");
      return;
    }
    if (signIn.status === "needs_new_password") {
      router.push(AUTH.forgot);
      return;
    }
    setProblem({ message: "That did not go through. Try again.", kind: "unknown" });
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !signIn) return;
    setBusy(true);
    setProblem(null);
    note("Checking your email and password");
    const { error } = await signIn.password({ emailAddress: email.trim(), password });
    if (error) {
      setProblem(problemOf(error));
      note("Sign-in refused");
    } else {
      await advance();
    }
    setBusy(false);
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !signIn) return;
    setBusy(true);
    setProblem(null);
    note("Checking the code");
    const result =
      factor === "email_code" ? await signIn.mfa.verifyEmailCode({ code }) : factor === "phone_code" ? await signIn.mfa.verifyPhoneCode({ code }) : factor === "totp" ? await signIn.mfa.verifyTOTP({ code }) : await signIn.mfa.verifyBackupCode({ code });
    if (result.error) {
      setProblem(problemOf(result.error));
      note("Code refused");
    } else {
      await advance();
    }
    setBusy(false);
  }

  async function resend() {
    if (!signIn || cooldown.left > 0 || busy) return;
    setProblem(null);
    const { error } = factor === "phone_code" ? await signIn.mfa.sendPhoneCode() : await signIn.mfa.sendEmailCode();
    if (error) return setProblem(problemOf(error));
    cooldown.start();
    note("New code sent");
  }

  /** Anything unexpected (a dropped connection mid-request, a failure inside the sign-in library) lands here. */
  const fail = (error: unknown) => {
    setProblem(problemOf(error));
    setBusy(false);
    setEntering(false);
    note("Stopped by an unexpected problem");
  };

  const working = busy || fetchStatus === "fetching";
  const failed = problem !== null && !working;
  const steps: TraceStep[] = [
    {
      key: "credentials",
      label: "Check your email and password",
      detail: "Sent over an encrypted connection and checked by the sign-in service. Selestial never sees or stores your password.",
      state: stage === "second" || entering || alreadyIn ? "done" : working ? "active" : failed ? "failed" : "needs_you",
    },
    ...(stage === "second"
      ? [{ key: "second", label: "Confirm it is you", detail: factor === "totp" ? "A code from your authenticator app." : factor === "backup_code" ? "One of your backup codes." : "A code sent to you, because this device is new or your account asks for a second step.", state: entering ? ("done" as const) : working ? ("active" as const) : failed ? ("failed" as const) : ("needs_you" as const) }]
      : []),
    { key: "session", label: "Confirm your session", detail: "Nothing opens until the session is confirmed as yours.", state: entering || alreadyIn ? "active" : "todo" },
    { key: "workspace", label: invited ? "Return to your invitation" : "Open your workspace", detail: invited ? "You go back to the invitation you opened." : "You land in your company, or in setup if you do not have one yet.", state: "todo" },
  ];

  if (stage === "second") {
    const fieldError = problem?.field === "code" ? problem.message : null;
    return (
      <AuthShell
        eyebrow="Sign in"
        title="Confirm it is you"
        lead={factor === "totp" ? "Enter the six-digit code from your authenticator app." : factor === "backup_code" ? "Enter one of your backup codes." : factor === "phone_code" ? "We sent a six-digit code to your phone." : `We sent a six-digit code to ${email.trim()}.`}
        steps={steps}
        events={events}
        below={
          <button type="button" className="font-medium text-[#5126c7] underline-offset-4 hover:underline" onClick={() => (setStage("password"), setProblem(null), setPassword(""))}>
            Use a different account
          </button>
        }
      >
        <form onSubmit={(event) => void submitCode(event).catch(fail)} className="grid gap-4" noValidate>
          {factor === "backup_code" ? (
            <TextField label="Backup code" value={code} onChange={(event) => setCode(event.target.value.trim())} autoComplete="off" required autoFocus error={fieldError} />
          ) : (
            <CodeField value={code} onChange={setCode} error={fieldError} autoFocus disabled={busy} />
          )}
          {problem && !fieldError ? <Notice tone="error">{problem.message}</Notice> : null}
          <SubmitButton busy={busy || entering} busyLabel={entering ? "Opening your workspace" : "Checking"} disabled={factor === "backup_code" ? code.length === 0 : code.length !== 6}>
            Continue
          </SubmitButton>
          {factor === "email_code" || factor === "phone_code" ? (
            <QuietButton onClick={() => void resend().catch(fail)} disabled={cooldown.left > 0 || busy}>
              {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : "Send a new code"}
            </QuietButton>
          ) : null}
        </form>
      </AuthShell>
    );
  }

  const emailError = problem?.field === "email" ? problem.message : null;
  const passwordError = problem?.field === "password" ? problem.message : null;
  return (
    <AuthShell
      eyebrow="Sign in"
      title="Welcome back"
      lead={invited ? "Sign in to accept your invitation." : "Sign in to your Selestial workspace."}
      steps={steps}
      events={events}
      below={
        <>
          New to Selestial? <AuthLink href={withNext(AUTH.signup, next)}>Create an account</AuthLink>
        </>
      }
    >
      <form onSubmit={(event) => void submitPassword(event).catch(fail)} className="grid gap-4" noValidate>
        {reason && REASONS[reason] && !problem ? <Notice tone="info">{REASONS[reason]}</Notice> : null}
        <TextField label="Email" type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required autoFocus error={emailError} disabled={entering} />
        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          error={passwordError}
          disabled={entering}
          trailing={
            <AuthLink href={AUTH.forgot} className="text-xs">
              Forgot password?
            </AuthLink>
          }
        />
        {problem && !emailError && !passwordError ? <Notice tone="error">{problem.message}</Notice> : null}
        <SubmitButton busy={busy || entering} busyLabel={entering ? "Opening your workspace" : "Signing in"} disabled={!signIn || email.trim() === "" || password === ""}>
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
