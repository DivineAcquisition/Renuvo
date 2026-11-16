"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CodeField, Notice, PasswordField, QuietButton, Requirements, SubmitButton, TextField, useCooldown } from "@/components/auth/fields";
import { goOn, RESET_DONE_NOTE, RESET_NOTE, tab, useTabNote } from "@/components/auth/flow";
import { AuthLink, AuthShell, useEvents, type TraceStep } from "@/components/auth/shell";
import { codeOf, problemOf, type AuthProblem } from "@/lib/auth/errors";
import { meets, requirements, type PasswordPolicy } from "@/lib/auth/password";
import { AUTH } from "@/lib/auth/routes";

/** The same sentence whether or not the email has an account, so the screen never tells one from the other. */
export const NEUTRAL = "If an account exists for this email, you’ll receive a password reset code.";

/** What the request screen leaves for the code screen. An email address, never a code or a password. */
type ResetNote = { email: string; at: number };

/** These answers mean "no such account" or "no password to reset". They are treated as accepted, silently. */
const SILENT = new Set(["form_identifier_not_found", "strategy_for_user_invalid", "form_param_format_invalid"]);

function recoverySteps(at: "request" | "sending" | "code" | "checking" | "password" | "saving" | "done" | "failed"): TraceStep[] {
  const order = ["request", "sending", "code", "checking", "password", "saving", "done"];
  const index = order.indexOf(at === "failed" ? "request" : at);
  const state = (waits: string, works: string, key: number): TraceStep["state"] => (at === "failed" && key === 0 ? "failed" : at === waits ? "needs_you" : at === works ? "active" : index > order.indexOf(works) ? "done" : "todo");
  return [
    { key: "request", label: "Ask for a reset code", detail: "The answer is the same whether or not the email has an account.", state: state("request", "sending", 0) },
    { key: "code", label: "Prove the request is yours", detail: "A six-digit code goes to the account’s email. Only that code allows a new password.", state: state("code", "checking", 1) },
    { key: "password", label: "Set a new password", detail: "Every other session is signed out when it is saved.", state: state("password", "saving", 2) },
    { key: "session", label: "Continue signed in", detail: "You carry on in this browser with the new password.", state: at === "done" ? "done" : "todo" },
  ];
}

export function ForgotScreen() {
  const router = useRouter();
  const { signIn } = useSignIn();
  const { events, note } = useEvents();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !signIn) return;
    const address = email.trim();
    setBusy(true);
    setProblem(null);
    note("Sending your request");
    // An account that does not exist is answered exactly like one that does. Only a failure of the
    // request itself (no connection, asked too often, service trouble) is shown as a failure.
    let failure: unknown = null;
    const started = await signIn.create({ identifier: address });
    if (started.error) {
      if (!SILENT.has(codeOf(started.error) ?? "")) failure = started.error;
    } else {
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error && !SILENT.has(codeOf(sent.error) ?? "")) failure = sent.error;
    }
    if (failure) {
      setProblem(problemOf(failure));
      note("Request did not go through");
      setBusy(false);
      return;
    }
    note("Request accepted");
    tab.set(RESET_NOTE, { email: address, at: Date.now() } satisfies ResetNote);
    try {
      window.sessionStorage.setItem("selestial.reset.code", String(Date.now() + 30_000));
    } catch {
      // The wait before asking again starts fresh on the next screen.
    }
    router.push(AUTH.reset);
  }

  const fail = (error: unknown) => {
    setProblem(problemOf(error));
    setBusy(false);
    note("Stopped by an unexpected problem");
  };

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Forgot your password?"
      lead="Enter your account’s email. We will send a code that lets you set a new password."
      steps={recoverySteps(busy ? "sending" : problem ? "failed" : "request")}
      events={events}
      below={<AuthLink href={AUTH.login}>Return to sign in</AuthLink>}
    >
      <form onSubmit={(event) => void submit(event).catch(fail)} className="grid gap-4" noValidate>
        <TextField label="Email" type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required autoFocus />
        {problem ? <Notice tone="error">{problem.message}</Notice> : null}
        <SubmitButton busy={busy} busyLabel="Sending" disabled={!signIn || !/^\S+@\S+\.\S+$/.test(email.trim())}>
          Send reset code
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function ResetScreen({ policy }: { policy: PasswordPolicy | null }) {
  const router = useRouter();
  const { signIn } = useSignIn();
  const { events, note } = useEvents();
  const request = useTabNote<ResetNote>(RESET_NOTE);
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown("selestial.reset.code", 30);

  // The service holds the real permission: a reset that was started in this browser and is waiting
  // for its code. Without it, the code step can only ever answer "not valid", and it says nothing more.
  const authorized = Boolean(signIn?.id) && (signIn?.status === "needs_first_factor" || signIn?.status === "needs_new_password");

  // The password step opens only once the service has accepted the code.
  const stage: "code" | "password" = codeAccepted || signIn?.status === "needs_new_password" ? "password" : "code";

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !signIn) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    note("Checking the code");
    if (!authorized) {
      await pause(700);
      setProblem({ message: "That code is not valid or has expired. Ask for a new one.", field: "code", kind: "code" });
      note("Code refused");
      setBusy(false);
      return;
    }
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (error) {
      const known = problemOf(error);
      setProblem(known.kind === "code" ? { ...known, message: "That code is not valid or has expired. Ask for a new one." } : known);
      note("Code refused");
    } else {
      note("Code accepted");
      setCodeAccepted(true);
    }
    setBusy(false);
  }

  async function resend() {
    if (!signIn || cooldown.left > 0 || busy || !request) return;
    setProblem(null);
    let failure: unknown = null;
    if (authorized) {
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error && !SILENT.has(codeOf(sent.error) ?? "")) failure = sent.error;
    } else {
      const started = await signIn.create({ identifier: request.email });
      if (started.error) {
        if (!SILENT.has(codeOf(started.error) ?? "")) failure = started.error;
      } else {
        const sent = await signIn.resetPasswordEmailCode.sendCode();
        if (sent.error && !SILENT.has(codeOf(sent.error) ?? "")) failure = sent.error;
      }
    }
    if (failure) return setProblem(problemOf(failure));
    cooldown.start();
    setResent(true);
    note("Request accepted again");
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (busy || !signIn || password !== confirm) return;
    setBusy(true);
    setProblem(null);
    note("Saving your new password");
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });
    if (error) {
      setProblem(problemOf(error));
      note("Password not saved");
      setBusy(false);
      return;
    }
    note("Password saved");
    tab.clear(RESET_NOTE);
    if (signIn.status !== "complete") {
      // The password is changed, but this account needs a second step before a session can open.
      router.replace(`${AUTH.login}?reason=password`);
      return;
    }
    tab.set(RESET_DONE_NOTE, { othersSignedOut: true, at: Date.now() });
    setEntering(true);
    const { error: failure } = await signIn.finalize({ navigate: goOn(router, AUTH.passwordUpdated) });
    if (failure) {
      setEntering(false);
      router.replace(`${AUTH.login}?reason=password`);
    }
  }

  const fail = (error: unknown) => {
    setProblem(problemOf(error));
    setBusy(false);
    setEntering(false);
    note("Stopped by an unexpected problem");
  };

  if (request === undefined) {
    return (
      <AuthShell eyebrow="Reset password" title="One moment" steps={recoverySteps("code")} events={events}>
        <p className="text-sm text-[#667085]" role="status">
          Loading.
        </p>
      </AuthShell>
    );
  }

  if (request === null && !authorized) {
    return (
      <AuthShell
        eyebrow="Reset password"
        title="Start your reset here"
        lead="A reset code works only in the browser where it was requested, and only for a while. Nothing on this page can change a password without one. Request a new code to continue."
        steps={recoverySteps("failed")}
        events={events}
        below={<AuthLink href={AUTH.login}>Return to sign in</AuthLink>}
      >
        <QuietButton onClick={() => router.push(AUTH.forgot)}>Request a reset code</QuietButton>
      </AuthShell>
    );
  }

  if (stage === "password") {
    const rows = policy ? requirements(policy, password) : null;
    const mismatch = touched && confirm !== "" && confirm !== password;
    const fieldError = problem?.field === "password" || problem?.field === "newPassword" ? problem.message : null;
    return (
      <AuthShell eyebrow="Reset password" title="Set a new password" lead="Choose a password you do not use anywhere else." steps={recoverySteps(entering ? "done" : busy ? "saving" : "password")} events={events}>
        <form onSubmit={(event) => void submitPassword(event).catch(fail)} className="grid gap-4" noValidate>
          {/* Lets a password manager file the new password under the right account. */}
          <input type="email" name="email" autoComplete="username" value={request?.email ?? signIn?.identifier ?? ""} readOnly hidden />
          <PasswordField
            label="New password"
            name="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
            autoFocus
            error={fieldError}
            hint={rows ? <Requirements rows={rows} extra={policy?.refusesBreached ? "Passwords found in known data breaches are refused." : undefined} /> : undefined}
          />
          <PasswordField label="Confirm new password" name="confirm-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} onBlur={() => setTouched(true)} autoComplete="new-password" required error={mismatch ? "The two passwords are not the same." : null} />
          {problem && !fieldError ? <Notice tone="error">{problem.message}</Notice> : null}
          <SubmitButton busy={busy || entering} busyLabel={entering ? "Signing you in" : "Saving"} disabled={!meets(policy, password) || confirm === ""}>
            Update password
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  const fieldError = problem?.field === "code" ? problem.message : null;
  return (
    <AuthShell
      eyebrow="Reset password"
      title="Enter your reset code"
      lead={request ? <>We took your request for <span className="font-semibold text-[#211a35]">{request.email}</span>.</> : "Enter the code from your email."}
      steps={recoverySteps(busy ? "checking" : "code")}
      events={events}
      below={<AuthLink href={AUTH.login}>Return to sign in</AuthLink>}
    >
      <form onSubmit={(event) => void submitCode(event).catch(fail)} className="grid gap-4" noValidate>
        <Notice tone="info">{NEUTRAL}</Notice>
        <CodeField label="Reset code" value={code} onChange={setCode} error={fieldError} autoFocus disabled={busy} hint="Use the newest email. The code works only in this browser." />
        {problem && !fieldError ? <Notice tone="error">{problem.message}</Notice> : null}
        {resent && !problem ? <Notice tone="success">Request accepted. If the account exists, a new code is on its way and earlier codes no longer work.</Notice> : null}
        <SubmitButton busy={busy} busyLabel="Checking" disabled={code.length !== 6}>
          Continue
        </SubmitButton>
        <QuietButton onClick={() => void resend().catch(fail)} disabled={cooldown.left > 0 || busy || !request}>
          {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : "Send a new code"}
        </QuietButton>
        <p className="text-center text-sm text-[#667085]">
          Different email? <AuthLink href={AUTH.forgot}>Start again</AuthLink>
        </p>
      </form>
    </AuthShell>
  );
}

export function PasswordUpdatedScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { events } = useEvents();
  const done = useTabNote<{ othersSignedOut: boolean }>(RESET_DONE_NOTE);
  // The reset is over: the note that carried the email to the code screen is no longer needed.
  useEffect(() => tab.clear(RESET_NOTE), []);
  const signedIn = isLoaded && isSignedIn;
  return (
    <AuthShell
      eyebrow="Reset password"
      title="Your password is updated"
      lead={signedIn ? "You are signed in on this device with the new password." : "Sign in with your new password to continue."}
      steps={recoverySteps("done")}
      events={events}
    >
      <div className="grid gap-4">
        <Notice tone="success">{done?.othersSignedOut ? "Password saved. Every other session on this account was signed out." : "Password saved."}</Notice>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            tab.clear(RESET_DONE_NOTE);
            router.replace(signedIn ? AUTH.callback : AUTH.login);
          }}
        >
          <SubmitButton busy={false} busyLabel="Opening" disabled={!isLoaded}>
            {signedIn ? "Continue to my workspace" : "Sign in"}
          </SubmitButton>
        </form>
      </div>
    </AuthShell>
  );
}
