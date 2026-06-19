"use client";

import { useFormState } from "react-dom";
import { completeOnboarding } from "@/app/actions/onboarding";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";

const VERTICALS = [
  { key: "cleaning", label: "Residential Cleaning" },
  { key: "lawn", label: "Lawn Care" },
  { key: "pool", label: "Pool Service" },
  { key: "pest", label: "Pest Control" },
];

export default function OnboardingPage() {
  const [state, action] = useFormState(completeOnboarding, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Set up your workspace
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          A couple of details and you&apos;re in.
        </p>

        <form action={action} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder="Novara Cleaning"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vertical">What service do you run?</Label>
            <select
              id="vertical"
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

          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <SubmitButton pendingText="Setting up…">Enter Renuvo</SubmitButton>
        </form>
      </div>
    </main>
  );
}
