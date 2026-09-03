import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { APP_NAME } from "@/lib/constants";
import { safeInternalPath } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = safeInternalPath(params.redirect);

  return (
    <AuthCard
      title="Welcome back"
      subtitle={`Sign in to continue to ${APP_NAME}`}
      eyebrowLabel="Private access"
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-brand-700 hover:underline">
            Start free
          </Link>
        </>
      }
    >
      <AuthForm intent="login" redirectTo={redirectTo} />
    </AuthCard>
  );
}
