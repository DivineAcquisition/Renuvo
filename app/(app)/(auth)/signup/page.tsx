"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { signUp, type AuthResult } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

export default function SignupPage() {
  const [state, action] = useFormState<AuthResult, FormData>(signUp, undefined);

  return (
    <>
      <div
        className="glass rounded-2xl p-7"
        style={{ boxShadow: "0 30px 80px -40px rgba(79,56,255,.4)" }}
      >
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Create your account
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Start turning one-time jobs into recurring revenue.
        </p>

        <form action={action} className="space-y-4">
          <Field label="Full name" htmlFor="fullName">
            <Input
              id="fullName"
              name="fullName"
              type="text"
              placeholder="Alex Rivera"
              autoComplete="name"
              required
            />
          </Field>
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
          <Field label="Password" htmlFor="password" hint="8+ characters.">
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="8+ characters"
              autoComplete="new-password"
              required
            />
          </Field>
          {state?.error && (
            <p className="text-sm font-medium text-destructive">{state.error}</p>
          )}
          <SubmitButton variant="gradient" size="lg" pendingText="Creating…">
            Create account
          </SubmitButton>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
