import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/app/auth-screen";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthScreen title="Sign in to Selestial" lead="The owner sets the standards. Selestial carries the work forward.">
      <SignIn />
    </AuthScreen>
  );
}
