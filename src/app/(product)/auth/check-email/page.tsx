import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/page";
import { CheckEmailScreen } from "@/components/auth/signup";

export const metadata: Metadata = { title: "Check your email" };

export default function Page() {
  return (
    <AuthPage>
      <CheckEmailScreen />
    </AuthPage>
  );
}
