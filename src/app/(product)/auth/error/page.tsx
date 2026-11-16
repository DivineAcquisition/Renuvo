import type { Metadata } from "next";

import { ErrorScreen } from "@/components/auth/misc";
import { AuthPage } from "@/components/auth/page";

export const metadata: Metadata = { title: "Sign-in problem" };

export default function Page() {
  return (
    <AuthPage>
      <ErrorScreen />
    </AuthPage>
  );
}
