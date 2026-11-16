"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { CodeField, ConsentField, Notice, PasswordField, QuietButton, Requirements, SubmitButton, TextField, useCooldown } from "@/components/auth/fields";
import { enter, goOn, useNext, useSkipWhenSignedIn } from "@/components/auth/flow";
import { AuthLink, AuthShell, useEvents, type TraceStep } from "@/components/auth/shell";
import { codeOf, problemOf, type AuthProblem } from "@/lib/auth/errors";
import { meets, requirements, splitName, type PasswordPolicy } from "@/lib/auth/password";
import { AUTH, inviteTokenIn, withNext } from "@/lib/auth/routes";

/** What this form collects. If the sign-in service asks for anything else, the screen says setup is unfinished. */
const COLLECTED = new Set(["email_address", "password", "first_name", "last_name", "legal_accepted"]);

function signupSteps(at: "form" | "sending" | "code" | "checking" | "entering" | "failed", invited: boolean): TraceStep[] {
  const order = ["form", "sending", "code", "checking", "entering"];
  const reached = (name: string) => order.indexOf(at === "failed" ? "form" : at) > order.indexOf(name);
  return [
    { key: "account", label: "Create your account", detail: "Your name, email and a password. Business details come later, in workspace setup.", state: at === "failed" ? "failed" : at === "form" ? "needs_you" : at === "sending" ? "active" : "done" },
    { key: "email", label: "Confirm your email", detail: "A six-digit code goes to your inbox. Your account is not active until you enter it.", state: at === "code" ? "needs_you" : at === "checking" ? "active" : reached("checking") ? "done" : "todo" },
    { key: "session", label: "Confirm your session", detail: "You are signed in only after the code checks out.", state: at === "entering" ? "active" : "todo" },
    { key: "workspace", label: invited ? "Return to your invitation" : "Set up your workspace", detail: invited ? "You go back to the invitation and join that company." : "Name your company. You become its Owner.", state: "todo" },
  ];
}

export function SignupScreen({ policy }: { policy: PasswordPolicy | null }) {
  const router = useRouter();
  const next = useNext();
  const { signUp } = useSignUp();
  const { events, note } = useEvents();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [touched, setTouched] = useState(false);
  useSkipWhenSignedIn(!busy, next);
  const invited = inviteTokenIn(next) !== null;
  const mismatch = touched && confirm !== "" && confirm !== password;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (busy || !signUp) return;
    if (password !== confirm || !agreed) return;
    setBusy(true);
    setProblem(null);
    note("Creating your account");
    const { firstName, lastName } = splitName(name);
    // The agreement is sent with the account, so the sign-in service records when it was given.
    const { error } = await signUp.password({ emailAddress: email.trim(), password, firstName, lastName, legalAccepted: true });
    if (error) {
      setProblem(problemOf(error));
      note(codeOf(error) === "form_identifier_exists" ? "This email already has an account" : "Account not created");
      setBusy(false);
      return;
    }
    const extra = signUp.missingFields.filter((field) => !COLLECTED.has(field) && field !== "protect_check");
    if (extra.length === 0 && signUp.missingFields.some((field) => field === "protect_check")) {
      setProblem({ message: "The security check could not be completed. Reload the page and try again.", kind: "unknown" });
      note("Security check not completed");
      setBusy(false);
      return;
    }
    if (extra.length > 0) {
      setProblem({ message: "We couldn’t create your account just now. Nothing was created. Please try again later.", kind: "setup" });
      note("Sign-up settings need changing");
      await signUp.reset();
      setBusy(false);
      return;
    }
    if (signUp.status === "complete") {
      note("Account created");
      const failure = await enter(signUp, router, next);
      if (failure) setProblem(problemOf(failure));
      setBusy(false);
      return;
    }
    const sent = await signUp.verifications.sendEmailCode();
    if (sent.error) {
      setProblem(problemOf(sent.error));
      note("Code could not be sent");
      setBusy(false);
      return;
    }
    note("Code sent to your email");
    router.push(withNext(AUTH.checkEmail, next));
  }

  const fail = (error: unknown) => {
    setProblem(problemOf(error));
    setBusy(false);
    note("Stopped by an unexpected problem");
  };

  const emailError = problem?.field === "email" ? problem.message : null;
  const passwordError = problem?.field === "password" ? problem.message : null;
  const rows = policy ? requirements(policy, password) : null;
  return (
    <AuthShell
      eyebrow="Create account"
      title={invited ? "Create your account to join" : "Start with Selestial"}
      lead={invited ? "Use the email address your invitation was sent to." : "Create your account. You will set up your company workspace next."}
      steps={signupSteps(busy ? "sending" : problem ? "failed" : "form", invited)}
      events={events}
      below={
        <>
          Already have an account? <AuthLink href={withNext(AUTH.login, next)}>Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event).catch(fail)} className="grid gap-4" noValidate>
        <TextField label="Full name" name="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required autoFocus maxLength={120} />
        <TextField label="Work email" type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required error={emailError} />
        <PasswordField
          label="Password"
          name="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required
          error={passwordError}
          hint={rows ? <Requirements rows={rows} extra={policy?.refusesBreached ? "Passwords found in known data breaches are refused." : undefined} /> : undefined}
        />
        <PasswordField label="Confirm password" name="confirm-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} onBlur={() => setTouched(true)} autoComplete="new-password" required error={mismatch ? "The two passwords are not the same." : null} />
        {problem && !emailError && !passwordError ? <Notice tone="error">{problem.message}</Notice> : null}
        {problem?.kind === "exists" ? (
          <p className="text-sm text-[#667085]">
            <AuthLink href={withNext(AUTH.login, next)}>Sign in</AuthLink> or <AuthLink href={AUTH.forgot}>reset your password</AuthLink>.
          </p>
        ) : null}
        <ConsentField checked={agreed} onChange={setAgreed} disabled={busy} />
        <SubmitButton busy={busy} busyLabel="Creating your account" disabled={!signUp || name.trim() === "" || email.trim() === "" || !meets(policy, password) || confirm === "" || !agreed}>
          Create account
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

/** The screen after sign-up: the address the code went to, the code itself, and a way to get another. */
export function CheckEmailScreen() {
  const router = useRouter();
  const next = useNext();
  const { signUp } = useSignUp();
  const { isLoaded, isSignedIn } = useAuth();
  const { events, note } = useEvents();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown("selestial.signup.code", 30);
  const invited = inviteTokenIn(next) !== null;
  const address = signUp?.emailAddress ?? null;
  const pending = Boolean(signUp?.id) && signUp?.status === "missing_requirements" && address !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !signUp) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    note("Checking the code");
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) {
      setProblem(problemOf(error));
      note("Code refused");
      setBusy(false);
      return;
    }
    if (signUp.status !== "complete") {
      setProblem({ message: "Your email is confirmed, but the account could not be finished. Start again from the sign-up page.", kind: "setup" });
      setBusy(false);
      return;
    }
    note("Email confirmed");
    setEntering(true);
    const { error: failure } = await signUp.finalize({ navigate: goOn(router, withNext(AUTH.verify, next)) });
    if (failure) {
      setEntering(false);
      setProblem(problemOf(failure));
    }
    setBusy(false);
  }

  async function resend() {
    if (!signUp || cooldown.left > 0 || busy) return;
    setProblem(null);
    const { error } = await signUp.verifications.sendEmailCode();
    if (error) return setProblem(problemOf(error));
    cooldown.start();
    setResent(true);
    note("New code sent");
  }

  if (isLoaded && isSignedIn && !entering) {
    return (
      <AuthShell eyebrow="Confirm your email" title="You are already signed in" steps={signupSteps("entering", invited)} events={events}>
        <QuietButton onClick={() => router.replace(withNext(AUTH.callback, next))}>Continue</QuietButton>
      </AuthShell>
    );
  }

  if (signUp && !pending && !entering) {
    return (
      <AuthShell
        eyebrow="Confirm your email"
        title="There is nothing to confirm here"
        lead="A code can only be entered in the browser where the account was started. If you opened this page somewhere else, or the sign-up was left too long, start again. If you already confirmed your email, sign in."
        steps={signupSteps("failed", invited)}
        events={events}
      >
        <div className="grid gap-3">
          <QuietButton onClick={() => router.push(withNext(AUTH.signup, next))}>Start again</QuietButton>
          <QuietButton onClick={() => router.push(withNext(AUTH.login, next))}>Sign in</QuietButton>
        </div>
      </AuthShell>
    );
  }

  const fail = (error: unknown) => {
    setProblem(problemOf(error));
    setBusy(false);
    setEntering(false);
    note("Stopped by an unexpected problem");
  };

  const fieldError = problem?.field === "code" ? problem.message : null;
  return (
    <AuthShell
      eyebrow="Confirm your email"
      title="Check your email"
      lead={
        address ? (
          <>
            We sent a six-digit code to <span className="font-semibold text-[#211a35]">{address}</span>. Enter it here to finish creating your account. You are not signed in yet.
          </>
        ) : (
          "Loading your sign-up."
        )
      }
      steps={signupSteps(entering ? "entering" : busy ? "checking" : "code", invited)}
      events={events}
      below={
        <>
          Wrong address? <AuthLink href={withNext(AUTH.signup, next)}>Start again with a different email</AuthLink>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event).catch(fail)} className="grid gap-4" noValidate>
        <CodeField value={code} onChange={setCode} error={fieldError} autoFocus disabled={busy || entering || !pending} hint="The code is in the newest email from Selestial. Check spam if it is not in your inbox." />
        {problem && !fieldError ? <Notice tone="error">{problem.message}</Notice> : null}
        {resent && !problem ? <Notice tone="success">A new code is on its way. Earlier codes no longer work.</Notice> : null}
        <SubmitButton busy={busy || entering} busyLabel={entering ? "Signing you in" : "Checking"} disabled={code.length !== 6 || !pending}>
          Confirm email
        </SubmitButton>
        <QuietButton onClick={() => void resend().catch(fail)} disabled={cooldown.left > 0 || busy || entering || !pending}>
          {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : "Send a new code"}
        </QuietButton>
      </form>
    </AuthShell>
  );
}

const LINK_RESULT: Record<string, { title: string; body: string; ok: boolean }> = {
  verified: { title: "Your email is confirmed", body: "This address now belongs to your account.", ok: true },
  expired: { title: "That link has expired", body: "Confirmation links stop working after a while. Ask for a new one from the page where you started.", ok: false },
  failed: { title: "That link did not work", body: "It may have been used already or copied incompletely. Ask for a new one from the page where you started.", ok: false },
  client_mismatch: { title: "Open the link in the same browser", body: "For your safety, a confirmation link works only in the browser where it was requested. Open it there, or ask for a new one.", ok: false },
};

/** The result of confirming an email: after a code on the last screen, or from a link in a message. */
export function VerifyScreen() {
  const router = useRouter();
  const next = useNext();
  const params = useSearchParams();
  const { isLoaded, isSignedIn } = useAuth();
  const { events } = useEvents();
  const invited = inviteTokenIn(next) !== null;
  const linked = LINK_RESULT[params.get("__clerk_status") ?? ""] ?? null;

  if (!isLoaded) {
    return (
      <AuthShell eyebrow="Confirm your email" title="One moment" steps={signupSteps("entering", invited)} events={events}>
        <p className="text-sm text-[#667085]" role="status">
          Confirming your session.
        </p>
      </AuthShell>
    );
  }
  if (linked && !linked.ok) {
    return (
      <AuthShell eyebrow="Confirm your email" title={linked.title} lead={linked.body} steps={signupSteps("failed", invited)} events={events}>
        <div className="grid gap-3">
          <QuietButton onClick={() => router.push(isSignedIn ? "/app/settings" : withNext(AUTH.login, next))}>{isSignedIn ? "Go to security settings" : "Sign in"}</QuietButton>
        </div>
      </AuthShell>
    );
  }
  if (isSignedIn) {
    const steps = signupSteps("entering", invited).map((step) => (step.key === "session" ? { ...step, state: "done" as const } : step.key === "workspace" ? { ...step, state: "needs_you" as const } : step));
    return (
      <AuthShell eyebrow="Confirm your email" title="Your email is confirmed" lead={invited ? "Your account is ready. Go back to your invitation to join the company." : "Your account is ready and you are signed in. Next, set up your company workspace."} steps={steps} events={events}>
        <div className="grid gap-4">
          <Notice tone="success">Email confirmed.</Notice>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              router.replace(withNext(AUTH.callback, next));
            }}
          >
            <SubmitButton busy={false} busyLabel="Opening">
              {invited ? "Go to my invitation" : "Set up my workspace"}
            </SubmitButton>
          </form>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      eyebrow="Confirm your email"
      title={linked?.ok ? linked.title : "There is nothing to confirm here"}
      lead={linked?.ok ? "Sign in to continue." : "If you were creating an account, go back to the code screen in the browser where you started. If your email is already confirmed, sign in."}
      steps={signupSteps(linked?.ok ? "entering" : "failed", invited)}
      events={events}
    >
      <div className="grid gap-3">
        <QuietButton onClick={() => router.push(withNext(AUTH.login, next))}>Sign in</QuietButton>
        {linked?.ok ? null : <QuietButton onClick={() => router.push(withNext(AUTH.checkEmail, next))}>Enter my code</QuietButton>}
      </div>
    </AuthShell>
  );
}
