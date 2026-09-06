"use client";

import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useActionState, useState } from "react";

import { AuthField, AuthOrDivider } from "@/components/auth/auth-fields";
import { Button, SubmitButton } from "@/components/ui/button";
import { sendMagicLink, signInPassword, signUpPassword, type AuthState } from "@/lib/auth/actions";

type Mode = "password" | "magic";

const initial: AuthState = { error: null };

export function AuthForm({
  intent,
  redirectTo,
}: {
  intent: "login" | "signup";
  redirectTo: string;
}) {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const passwordAction = intent === "signup" ? signUpPassword : signInPassword;
  const [passwordState, passwordFormAction, passwordPending] = useActionState(passwordAction, initial);
  const [magicState, magicFormAction, magicPending] = useActionState(sendMagicLink, initial);

  const pending = mode === "password" ? passwordPending : magicPending;
  const error = mode === "password" ? passwordState.error : magicState.error;
  const magicSent = mode === "magic" ? magicState.magicSent : passwordState.magicSent;
  const action = mode === "password" ? passwordFormAction : magicFormAction;

  if (magicSent) {
    return (
      <p className="auth-notice">
        Check {email || "that address"} for a confirmation link. It expires quickly; request another
        if it does not arrive.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <AuthField
        icon={Mail}
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@company.com"
        label="Email"
        aria-label="Email"
      />

      {mode === "password" ? (
        <AuthField
          icon={Lock}
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete={intent === "signup" ? "new-password" : "current-password"}
          required
          placeholder={intent === "signup" ? "Create a password" : "Enter your password"}
          label="Password"
          aria-label="Password"
          action={
            <button
              type="button"
              className="auth-field-action"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />
      ) : null}

      <SubmitButton
        variant="gradient"
        size="lg"
        pending={pending}
        loadingLabel="Working"
        className="auth-submit mt-2 w-full"
      >
        {intent === "signup" ? "Start seeing patterns" : "Continue"}
      </SubmitButton>

      <AuthOrDivider />

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="auth-alt w-full"
        onClick={() => {
          setMode((current) => (current === "password" ? "magic" : "password"));
          setShowPassword(false);
        }}
      >
        {mode === "password" ? "Continue with a magic link" : "Continue with a password"}
      </Button>
    </form>
  );
}
