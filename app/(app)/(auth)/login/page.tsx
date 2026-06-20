"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { signIn, type AuthResult } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

export default function LoginPage() {
  const [state, action] = useFormState<AuthResult, FormData>(signIn, undefined);

  return (
    <>
      <div
        className="glass rounded-2xl p-7"
        style={{ boxShadow: "0 30px 80px -40px rgba(79,56,255,.4)" }}
      >
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Sign in to your Renuvo account.
        </p>

        <form action={action} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {state?.error && (
            <p className="text-sm font-medium text-destructive">{state.error}</p>
          )}
          <SubmitButton variant="gradient" size="lg" pendingText="Signing in…">
            Sign in
          </SubmitButton>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}
