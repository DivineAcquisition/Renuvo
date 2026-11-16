import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/page";
import { ForgotScreen } from "@/components/auth/recovery";

export const metadata: Metadata = { title: "Reset password" };

export default function Page() {
  return (
    <AuthPage>
      <ForgotScreen />
    </AuthPage>
  );
}
