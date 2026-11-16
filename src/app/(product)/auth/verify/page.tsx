import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/page";
import { VerifyScreen } from "@/components/auth/signup";

export const metadata: Metadata = { title: "Email confirmation" };

export default function Page() {
  return (
    <AuthPage>
      <VerifyScreen />
    </AuthPage>
  );
}
