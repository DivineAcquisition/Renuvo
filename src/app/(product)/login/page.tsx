import type { Metadata } from "next";

import { LoginScreen } from "@/components/auth/login";
import { AuthPage } from "@/components/auth/page";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <AuthPage>
      <LoginScreen />
    </AuthPage>
  );
}
