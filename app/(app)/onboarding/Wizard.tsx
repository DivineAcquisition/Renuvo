"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import {
  createOrganizationStep,
  provisionNumberStep,
  finishOnboarding,
} from "@/app/actions/onboarding";
import { CsvImport } from "./CsvImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OnboardingState } from "@/lib/onboarding/state";

const VERTICALS = [
  { key: "cleaning", label: "Residential Cleaning" },
  { key: "lawn", label: "Lawn Care" },
  { key: "pool", label: "Pool Service" },
  { key: "pest", label: "Pest Control" },
];

function StepShell({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-5">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
            done ? "bg-primary text-primary-foreground" : "bg-secondary"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <h3 className="font-display font-bold">{title}</h3>
      </div>
      <div className="pl-10">{children}</div>
    </div>
  );
}

export function Wizard({
  state,
  businessName,
}: {
  state: OnboardingState;
  businessName: string;
  walletBalanceCents: number;
}) {
  const [orgState, createAction] = useFormState(
    createOrganizationStep,
    undefined
  );
  const [number, setNumber] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);

  async function getNumber() {
    setProvisioning(true);
    const res = await provisionNumberStep();
    setProvisioning(false);
    if ("number" in res && res.number) setNumber(res.number);
  }

  if (!state.hasOrg) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-1 font-display text-2xl font-bold">
          Set up your workspace
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Start with the basics.
        </p>
        <form action={createAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Business name</Label>
            <Input name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label>Service</Label>
            <select
              name="vertical"
              defaultValue="cleaning"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {VERTICALS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          {orgState && "error" in orgState && (
            <p className="text-sm text-destructive">{orgState.error}</p>
          )}
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">
          Finish setting up {businessName}
        </h1>
        <p className="text-sm text-muted-foreground">
          A few connections and you&apos;re live.
        </p>
      </div>

      <StepShell n={2} title="Connect your Stripe" done={state.stripeConnected}>
        {state.stripeConnected ? (
          <p className="text-sm text-primary">Connected ✓</p>
        ) : (
          <Button asChild>
            <Link href="/api/stripe/connect">Connect Stripe</Link>
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Lets Renuvo detect paid jobs and bill recurring plans. Don&apos;t use
          Stripe? You can skip and mark jobs paid manually.
        </p>
      </StepShell>

      <StepShell n={3} title="Get your texting number" done={state.hasNumber}>
        {state.hasNumber ? (
          <p className="text-sm text-primary">
            Number active ✓{" "}
            {state.a2pStatus !== "approved" && (
              <span className="text-amber-600">
                · A2P registration {state.a2pStatus}
              </span>
            )}
          </p>
        ) : (
          <Button onClick={getNumber} disabled={provisioning}>
            {provisioning ? "Getting a number…" : "Get a number"}
          </Button>
        )}
        {number && <p className="mt-2 font-mono text-sm">{number}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          A2P 10DLC registration is required before texts deliver reliably —
          we&apos;ll guide you through it.
        </p>
      </StepShell>

      <StepShell n={4} title="Add an SMS balance" done={state.hasCard}>
        {state.hasCard ? (
          <p className="text-sm text-primary">Card on file ✓</p>
        ) : (
          <Button asChild variant="outline">
            <Link href="/dashboard/settings/payments">Add a card</Link>
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Messages bill at $0.02 each from your balance. Auto-reload keeps
          sequences running.
        </p>
      </StepShell>

      <StepShell
        n={5}
        title="Import your customers"
        done={state.customerCount > 0}
      >
        <CsvImport currentCount={state.customerCount} />
      </StepShell>

      <div className="flex justify-end pt-2">
        <form action={finishOnboarding}>
          <Button type="submit">Enter Renuvo</Button>
        </form>
      </div>
    </main>
  );
}
