import type { Metadata } from "next";

import { CallbackScreen } from "@/components/auth/misc";
import { AuthPage } from "@/components/auth/page";

export const metadata: Metadata = { title: "Signing in" };

export default function Page() {
  return (
    <AuthPage>
      <CallbackScreen />
    </AuthPage>
  );
}
