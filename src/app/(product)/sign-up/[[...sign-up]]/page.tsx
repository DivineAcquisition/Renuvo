import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/app/auth-screen";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <AuthScreen title="Create your Selestial account" lead="Set up your company, then meet your team.">
      <SignUp />
    </AuthScreen>
  );
}
