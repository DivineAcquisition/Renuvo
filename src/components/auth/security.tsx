"use client";

import { useSession, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";

import { Panel } from "@/components/app/shell";
import { CodeField, Notice, PasswordField, Requirements, TextField, useCooldown } from "@/components/auth/fields";
import { useSignOut } from "@/components/auth/user-menu";
import { DesktopIcon, DeviceMobileIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { codeOf, problemOf, type AuthProblem } from "@/lib/auth/errors";
import { meets, policyFrom, requirements, type PasswordPolicy } from "@/lib/auth/password";

/**
 * Some changes need the password again, even when signed in. The sign-in service decides when; this
 * asks for it and then retries the change. `again` holds the change that is waiting.
 */
/** Thrown to a change that was waiting on the password when the person closes the prompt instead. */
const CANCELLED = { cancelled: true } as const;
const wasCancelled = (error: unknown) => error === CANCELLED;

type Waiting = { work: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };

function useConfirm() {
  const { session } = useSession();
  const [again, setAgain] = useState<Waiting | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);

  /**
   * Runs a change and settles when it has really finished. If the service asks for the password
   * first, the prompt opens and the change waits; whatever happens after that, success or failure,
   * comes back to the caller, so nothing is lost behind the prompt.
   */
  const guarded = useCallback(
    (work: () => Promise<void>) =>
      new Promise<void>((resolve, reject) => {
        work().then(resolve, (error: unknown) => {
          if (codeOf(error) !== "session_reverification_required") return reject(error);
          setProblem(null);
          setPassword("");
          setAgain({ work, resolve, reject });
        });
      }),
    [],
  );

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !again || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await session.startVerification({ level: "first_factor" });
      await session.attemptFirstFactorVerification({ strategy: "password", password });
    } catch (error) {
      const known = problemOf(error);
      setProblem(known.kind === "credentials" ? { ...known, message: "That password is not right.", field: "password" } : known);
      setBusy(false);
      return;
    }
    const waiting = again;
    setAgain(null);
    setPassword("");
    setBusy(false);
    waiting.work().then(waiting.resolve, waiting.reject);
  }

  function cancel() {
    again?.reject(CANCELLED);
    setAgain(null);
  }

  const prompt = again ? (
    <form onSubmit={confirm} className="mt-4 grid max-w-md gap-3 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4" aria-label="Confirm your password">
      <p className="text-sm font-medium text-strong">Confirm your password to continue</p>
      <p className="text-xs text-muted-foreground">For your safety, this change needs your password again.</p>
      <PasswordField label="Password" name="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus error={problem?.field === "password" ? problem.message : null} />
      {problem && problem.field !== "password" ? <Notice tone="error">{problem.message}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={password === ""}>
          Confirm
        </Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </form>
  ) : null;
  return { guarded, prompt, waiting: again !== null };
}

/** The password rules as the sign-in service has them, read once for this page. */
function usePolicy(): PasswordPolicy | null {
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/app/settings/password-policy")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (live) setPolicy(policyFrom(body));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return policy;
}

function ChangePassword() {
  const { user } = useUser();
  const policy = usePolicy();
  const { guarded, prompt, waiting } = useConfirm();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [done, setDone] = useState<null | { others: boolean }>(null);
  const mismatch = confirm !== "" && confirm !== next;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy || next !== confirm) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    const signOutOthers = others;
    try {
      await guarded(async () => {
        await user.updatePassword({ currentPassword: current, newPassword: next, signOutOfOtherSessions: signOutOthers });
        setCurrent("");
        setNext("");
        setConfirm("");
        setDone({ others: signOutOthers });
      });
    } catch (error) {
      const known = problemOf(error);
      if (!wasCancelled(error)) setProblem(known.kind === "credentials" ? { message: "The current password is not right.", field: "currentPassword", kind: "credentials" } : known);
    }
    setBusy(false);
  }

  const rows = policy ? requirements(policy, next) : null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-strong">Password</h3>
      <form onSubmit={submit} className="mt-3 grid max-w-md gap-3" noValidate>
        <input type="email" name="email" autoComplete="username" value={user?.primaryEmailAddress?.emailAddress ?? ""} readOnly hidden />
        <PasswordField label="Current password" name="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required error={problem?.field === "currentPassword" ? problem.message : null} />
        <PasswordField
          label="New password"
          name="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          required
          error={problem?.field === "password" || problem?.field === "newPassword" ? problem.message : null}
          hint={rows ? <Requirements rows={rows} extra={policy?.refusesBreached ? "Passwords found in known data breaches are refused." : undefined} /> : undefined}
        />
        <PasswordField label="Confirm new password" name="confirm-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required error={mismatch ? "The two passwords are not the same." : null} />
        <label className="flex items-start gap-2 text-sm text-strong">
          <input type="checkbox" checked={others} onChange={(event) => setOthers(event.target.checked)} className="mt-0.5 size-4 accent-[#6838ef]" />
          Sign out every other session when the password changes
        </label>
        {problem && !problem.field ? <Notice tone="error">{problem.message}</Notice> : null}
        {done ? <Notice tone="success">{done.others ? "Password updated. Every other session was signed out." : "Password updated. Other sessions stay signed in."}</Notice> : null}
        <div>
          <Button type="submit" variant="primary" loading={busy && !waiting} disabled={current === "" || !meets(policy, next) || confirm === "" || mismatch}>
            Update password
          </Button>
        </div>
      </form>
      {prompt}
    </div>
  );
}

function ChangeEmail() {
  const { user } = useUser();
  const { guarded, prompt } = useConfirm();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const cooldown = useCooldown("selestial.email.code", 30);
  if (!user) return <Skeleton className="h-24" />;

  const primary = user.primaryEmailAddress;
  // An address that was added but not confirmed yet. It is not the sign-in email until its code is entered.
  const pending = user.emailAddresses.find((row) => row.id !== user.primaryEmailAddressId && row.verification?.status !== "verified") ?? null;

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !user) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    const address = email.trim();
    try {
      await guarded(async () => {
        const created = await user.createEmailAddress({ email: address });
        await created.prepareVerification({ strategy: "email_code" });
        await user.reload();
        cooldown.start();
        setEmail("");
        setCode("");
      });
    } catch (error) {
      const known = problemOf(error);
      if (!wasCancelled(error)) setProblem(codeOf(error) === "form_identifier_exists" ? { message: "That email is already used by an account.", field: "email", kind: "exists" } : known);
    }
    setBusy(false);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !pending || !user) return;
    setBusy(true);
    setProblem(null);
    try {
      const previous = primary;
      const address = pending.emailAddress;
      await guarded(async () => {
        const confirmed = await pending.attemptVerification({ code });
        if (confirmed.verification?.status !== "verified") throw { errors: [{ code: "form_code_incorrect" }] };
        await user.update({ primaryEmailAddressId: confirmed.id });
        // The old address is removed only after the new one is confirmed and in use.
        if (previous && previous.id !== confirmed.id) await previous.destroy().catch(() => undefined);
        await user.reload();
        setCode("");
        setDone(address);
      });
    } catch (error) {
      if (!wasCancelled(error)) setProblem(problemOf(error));
    }
    setBusy(false);
  }

  async function resend() {
    if (!pending || cooldown.left > 0 || busy) return;
    setProblem(null);
    try {
      await pending.prepareVerification({ strategy: "email_code" });
      cooldown.start();
    } catch (error) {
      setProblem(problemOf(error));
    }
  }

  async function cancel() {
    if (!pending || busy || !user) return;
    setBusy(true);
    try {
      await pending.destroy();
      await user.reload();
      setCode("");
      setProblem(null);
    } catch (error) {
      setProblem(problemOf(error));
    }
    setBusy(false);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-strong">Email</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        You sign in as <span className="font-medium text-strong">{primary?.emailAddress ?? "an unknown address"}</span>.
      </p>
      {done ? (
        <div className="mt-3 max-w-md">
          <Notice tone="success">Your sign-in email is now {done}.</Notice>
        </div>
      ) : null}
      {pending ? (
        <form onSubmit={verify} className="mt-3 grid max-w-md gap-3" noValidate>
          <Notice tone="info" title="Waiting for confirmation">
            We sent a six-digit code to {pending.emailAddress}. Until you enter it, nothing has changed: you still sign in as {primary?.emailAddress}.
          </Notice>
          <CodeField value={code} onChange={setCode} error={problem?.field === "code" ? problem.message : null} disabled={busy} />
          {problem && problem.field !== "code" ? <Notice tone="error">{problem.message}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
              Confirm new email
            </Button>
            <Button type="button" variant="secondary" onClick={() => void resend()} disabled={cooldown.left > 0 || busy}>
              {cooldown.left > 0 ? `New code in ${cooldown.left}s` : "Send a new code"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void cancel()} disabled={busy}>
              Cancel the change
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={start} className="mt-3 grid max-w-md gap-3" noValidate>
          <TextField label="New email" type="email" name="new-email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required error={problem?.field === "email" ? problem.message : null} hint="We send a code to the new address. Your sign-in email changes only after you enter it." />
          {problem && problem.field !== "email" ? <Notice tone="error">{problem.message}</Notice> : null}
          <div>
            <Button type="submit" variant="secondary" loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || email.trim().toLowerCase() === primary?.emailAddress.toLowerCase()}>
              Send code
            </Button>
          </div>
        </form>
      )}
      {prompt}
    </div>
  );
}

type SessionRow = { id: string; current: boolean; device: string; mobile: boolean; where: string; lastActive: Date | null; revoke: () => Promise<unknown> };

function Sessions() {
  const { user } = useUser();
  const { session } = useSession();
  const signOut = useSignOut();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const sessions = await user.getSessions();
      setRows(
        sessions
          .filter((row) => row.status === "active")
          .map((row) => ({
            id: row.id,
            current: row.id === session?.id,
            device: [row.latestActivity?.browserName, row.latestActivity?.deviceType].filter(Boolean).join(" on ") || "Unknown device",
            mobile: row.latestActivity?.isMobile === true,
            where: [row.latestActivity?.city, row.latestActivity?.country].filter(Boolean).join(", "),
            lastActive: row.lastActiveAt ?? null,
            revoke: () => row.revoke(),
          }))
          .sort((a, b) => Number(b.current) - Number(a.current)),
      );
    } catch (error) {
      setProblem(problemOf(error));
      setRows([]);
    }
  }, [session?.id, user]);

  useEffect(() => {
    // Reads the list from the sign-in service; the state is set when the answer arrives, not during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function signOutOthers() {
    if (!rows || busy) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    const others = rows.filter((row) => !row.current);
    let ended = 0;
    let failure: unknown = null;
    for (const row of others) {
      try {
        await row.revoke();
        ended += 1;
      } catch (error) {
        failure = error;
      }
    }
    // Only what actually ended is reported.
    if (failure) setProblem({ message: ended > 0 ? `${ended} of ${others.length} other sessions were signed out. The rest could not be reached; try again.` : problemOf(failure).message, kind: "unknown" });
    else setDone(ended);
    await load();
    setBusy(false);
  }

  const others = rows?.filter((row) => !row.current).length ?? 0;
  return (
    <div>
      <h3 className="text-sm font-semibold text-strong">Sessions</h3>
      <p className="mt-1 text-sm text-muted-foreground">Where this account is signed in.</p>
      {rows === null ? (
        <Skeleton className="mt-3 h-16" />
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3.5 py-3 text-sm">
              {row.mobile ? <DeviceMobileIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden /> : <DesktopIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-strong">{row.device}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.where, row.lastActive ? `Last active ${row.lastActive.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              {row.current ? (
                <Badge variant="outline" size="sm">
                  This device
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <div className="mt-3 max-w-md">
          <Notice tone="error">{problem.message}</Notice>
        </div>
      ) : null}
      {done !== null ? (
        <div className="mt-3 max-w-md">
          <Notice tone="success">{done === 0 ? "There were no other sessions." : done === 1 ? "1 other session was signed out." : `${done} other sessions were signed out.`}</Notice>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} disabled={rows === null || others === 0} onClick={() => void signOutOthers()}>
          Sign out other sessions
        </Button>
        <Button
          variant="ghost"
          loading={leaving}
          onClick={() => {
            setLeaving(true);
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Settings → Security: the account's email, its password, and where it is signed in. */
export function SecuritySettings() {
  const { user, isLoaded } = useUser();
  return (
    <section id="security" className="scroll-mt-24">
      <Panel title="Security">
        {!isLoaded ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-8">
            <ChangeEmail />
            <ChangePassword />
            <Sessions />
            <div>
              <h3 className="text-sm font-semibold text-strong">Two-step sign-in</h3>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {user?.twoFactorEnabled
                  ? "This account has a second step turned on, and sign-in asks for it. Changing it from this page is not built yet."
                  : "A second step at sign-in (an authenticator app or a text code) is not offered from this page yet. When you sign in from a device that has not been used before, a code may still be sent to your email."}
              </p>
            </div>
          </div>
        )}
      </Panel>
    </section>
  );
}
