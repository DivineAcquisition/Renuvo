import type { Metadata } from "next";

import { InviteScreen } from "@/components/auth/invite";
import { AuthPage } from "@/components/auth/page";

export const metadata: Metadata = { title: "Invitation", referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthPage>
      <InviteScreen token={decodeURIComponent(token)} />
    </AuthPage>
  );
}
