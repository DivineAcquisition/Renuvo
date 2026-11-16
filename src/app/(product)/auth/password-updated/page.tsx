import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/page";
import { PasswordUpdatedScreen } from "@/components/auth/recovery";

export const metadata: Metadata = { title: "Password updated" };

export default function Page() {
  return (
    <AuthPage>
      <PasswordUpdatedScreen />
    </AuthPage>
  );
}
