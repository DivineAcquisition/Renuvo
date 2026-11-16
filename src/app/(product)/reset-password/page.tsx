import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/page";
import { ResetScreen } from "@/components/auth/recovery";
import { passwordPolicy } from "@/lib/auth/policy.server";

export const metadata: Metadata = { title: "Set a new password" };

export default async function Page() {
  const policy = await passwordPolicy();
  return (
    <AuthPage>
      <ResetScreen policy={policy} />
    </AuthPage>
  );
}
