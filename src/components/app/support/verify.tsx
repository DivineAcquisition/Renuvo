"use client";

import { useAuth, useSession } from "@clerk/nextjs";
import { useConvex } from "convex/react";
import { useState } from "react";

import { Field, FormError, TextInput } from "@/components/app/form";
import { Button } from "@/components/ui/button";

/** The record accepts a second factor this recent (convex/lib/support/catalog.ts RECENT_VERIFICATION_MINUTES), less a minute of slack. */
const FRESH_MINUTES = 9;

type Strategy = "totp" | "phone_code" | "backup_code";

/**
 * Starting a support session, switching to Manage, extending and revealing content all need a second
 * factor confirmed in the last ten minutes. This asks for one with Selestial's own screen (the sign-in
 * service is used headlessly), then fetches a fresh record token so the server sees the new time.
 *
 * The server decides from the token's `fva` claim; nothing this component says is trusted.
 */
export function SecondFactor({ onVerified, label = "Confirm and continue", busy: outerBusy = false }: { onVerified: () => Promise<void> | void; label?: string; busy?: boolean }) {
  const { session } = useSession();
  const { getToken } = useAuth();
  const convex = useConvex();
  const [stage, setStage] = useState<"idle" | "code">("idle");
  const [strategy, setStrategy] = useState<Strategy>("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const age = session?.factorVerificationAge?.[1] ?? -1;
  const fresh = age >= 0 && age <= FRESH_MINUTES;

  /** A new record token carrying the new verification time, before the next request goes. */
  async function refreshToken() {
    await new Promise<void>((resolve) => {
      let first = true;
      convex.setAuth(
        async () => {
          try {
            const token = await getToken({ template: "convex", skipCache: first });
            first = false;
            return token;
          } catch {
            return null;
          }
        },
        () => resolve(),
      );
    });
  }

  async function finish() {
    await refreshToken();
    await onVerified();
  }

  async function begin() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      if (fresh) {
        await finish();
        return;
      }
      const started = await session.startVerification({ level: "second_factor" });
      const factors = started.supportedSecondFactors ?? [];
      const totp = factors.find((factor) => factor.strategy === "totp");
      const phone = factors.find((factor) => factor.strategy === "phone_code");
      if (totp) setStrategy("totp");
      else if (phone && "phoneNumberId" in phone) {
        await session.prepareSecondFactorVerification({ strategy: "phone_code", phoneNumberId: phone.phoneNumberId as string });
        setStrategy("phone_code");
      } else if (factors.some((factor) => factor.strategy === "backup_code")) setStrategy("backup_code");
      else {
        setError("Your account has no second factor. Turn on two-step verification in your account security settings first.");
        return;
      }
      setStage("code");
    } catch {
      setError("Two-step verification could not start. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const result = await session.attemptSecondFactorVerification({ strategy, code: code.trim() } as Parameters<typeof session.attemptSecondFactorVerification>[0]);
      if (result.status !== "complete") {
        setError("That code didn't work. Check it and try again.");
        return;
      }
      await finish();
    } catch {
      setError("That code didn't work. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "code") {
    return (
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <Field label={strategy === "phone_code" ? "Code sent to your phone" : strategy === "backup_code" ? "Backup code" : "Code from your authenticator app"}>
          <TextInput value={code} onChange={(event) => setCode(event.target.value)} inputMode={strategy === "backup_code" ? "text" : "numeric"} autoComplete="one-time-code" autoFocus required />
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" size="sm" loading={busy || outerBusy} disabled={code.trim().length < 6}>
          {label}
        </Button>
      </form>
    );
  }
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">{fresh ? `You confirmed your second factor ${age} ${age === 1 ? "minute" : "minutes"} ago.` : "You'll confirm it's you with your second factor."}</p>
      <FormError message={error} />
      <Button type="button" variant="primary" size="sm" loading={busy || outerBusy} disabled={!session} onClick={() => void begin()}>
        {label}
      </Button>
    </div>
  );
}
