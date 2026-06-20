"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  CreditCard,
  Phone,
  Wallet,
  Upload,
  Check,
  ArrowRight,
} from "lucide-react";
import {
  createOrganizationStep,
  provisionNumberStep,
  finishOnboarding,
} from "@/app/actions/onboarding";
import { CsvImport } from "./CsvImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Reveal } from "@/components/ui/reveal";
import { LogoMark } from "@/components/ui/logo";
import type { OnboardingState } from "@/lib/onboarding/state";

const VERTICALS = [
  { key: "cleaning", label: "Residential Cleaning" },
  { key: "lawn", label: "Lawn Care" },
  { key: "pool", label: "Pool Service" },
  { key: "pest", label: "Pest Control" },
];

function StepCard({
  index,
  title,
  subtitle,
  icon,
  done,
  children,
}: {
  index: number;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <Reveal delay={index * 0.07}>
      <div className="glass hover-lift rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
              done
                ? "bg-gradient-to-br from-[#6A57FF] to-[#4F38FF] text-white shadow-lg shadow-primary/30"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {done ? <Check className="h-5 w-5" /> : icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display font-bold">{title}</h3>
              {done && (
                <span className="text-xs font-semibold text-primary">Done</span>
              )}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </Reveal>
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
    if ("number" in res && res.number) {
      setNumber(res.number);
      toast.success("Texting number provisioned.");
    } else {
      toast.error(
        ("error" in res && res.error) ||
          "Couldn't get a number. Check your Telnyx setup and try again."
      );
    }
  }

  // ---- create-org screen --------------------------------------------------
  if (!state.hasOrg) {
    return (
      <main className="ambient-wash flex min-h-screen items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="mb-6 flex flex-col items-center text-center">
            <LogoMark className="mb-4 h-12 w-12" />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Welcome to <span className="gradient-text">Renuvo</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Let&apos;s set up your workspace.
            </p>
          </div>

          <div className="glass rounded-2xl p-7">
            <form action={createAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Business name</Label>
                <Input name="name" placeholder="Novara Cleaning" required />
              </div>
              <div className="space-y-1.5">
                <Label>What service do you run?</Label>
                <select
                  name="vertical"
                  defaultValue="cleaning"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
              <Button type="submit" variant="gradient" className="w-full">
                Continue
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </form>
          </div>
        </motion.div>
      </main>
    );
  }

  // ---- setup stepper ------------------------------------------------------
  const steps = [
    state.stripeConnected,
    state.hasNumber,
    state.hasCard,
    state.customerCount > 0,
  ];
  const completed = steps.filter(Boolean).length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <main className="ambient-wash mx-auto max-w-2xl space-y-6 p-6">
      <Reveal>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Finish setting up {businessName}
          </h1>
          <p className="text-sm text-muted-foreground">
            A few connections and you&apos;re live.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-[#6A57FF] to-[#4F38FF]"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {completed}/{steps.length}
            </span>
          </div>
        </div>
      </Reveal>

      <StepCard
        index={0}
        title="Connect your Stripe"
        subtitle="Lets Renuvo detect paid jobs and bill recurring plans."
        icon={<CreditCard className="h-5 w-5" />}
        done={state.stripeConnected}
      >
        {state.stripeConnected ? (
          <p className="text-sm text-primary">Connected ✓</p>
        ) : (
          <Button asChild variant="gradient" size="sm">
            <Link href="/api/stripe/connect">Connect Stripe</Link>
          </Button>
        )}
      </StepCard>

      <StepCard
        index={1}
        title="Get your texting number"
        subtitle="A number alone isn't enough — A2P registration is required to send."
        icon={<Phone className="h-5 w-5" />}
        done={state.hasNumber}
      >
        {state.hasNumber ? (
          <p className="text-sm text-primary">
            Number active ✓{" "}
            {state.a2pStatus !== "approved" && (
              <span className="text-amber-600">
                · A2P {state.a2pStatus}
              </span>
            )}
          </p>
        ) : (
          <Button onClick={getNumber} disabled={provisioning} size="sm">
            {provisioning ? "Getting a number…" : "Get a number"}
          </Button>
        )}
        {number && <p className="mt-2 font-mono text-sm">{number}</p>}
        {state.hasNumber && (
          <Link
            href="/dashboard/settings/messaging/a2p"
            className="mt-2 inline-block text-xs font-medium text-primary underline"
          >
            Register for A2P →
          </Link>
        )}
      </StepCard>

      <StepCard
        index={2}
        title="Add an SMS balance"
        subtitle="Messages bill at $0.02 each. Auto-reload keeps sequences running."
        icon={<Wallet className="h-5 w-5" />}
        done={state.hasCard}
      >
        {state.hasCard ? (
          <p className="text-sm text-primary">Card on file ✓</p>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/settings/payments">Add a card</Link>
          </Button>
        )}
      </StepCard>

      <StepCard
        index={3}
        title="Import your customers"
        subtitle="Upload a CSV. Only customers with SMS consent get texted."
        icon={<Upload className="h-5 w-5" />}
        done={state.customerCount > 0}
      >
        <CsvImport currentCount={state.customerCount} />
      </StepCard>

      <Reveal delay={0.3}>
        <div className="flex justify-end pt-2">
          <form action={finishOnboarding}>
            <Button type="submit" variant="gradient" size="lg">
              Enter Renuvo
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </form>
        </div>
      </Reveal>
    </main>
  );
}
