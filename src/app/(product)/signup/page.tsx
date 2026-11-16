import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/page";
import { SignupScreen } from "@/components/auth/signup";
import { passwordPolicy } from "@/lib/auth/policy.server";

export const metadata: Metadata = { title: "Create account" };

export default async function Page() {
  const policy = await passwordPolicy();
  return (
    <AuthPage>
      <SignupScreen policy={policy} />
    </AuthPage>
  );
}
