import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthForm } from "@/components/auth/auth-form";
import { safeInternalPath } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = safeInternalPath(params.redirect);

  return (
    <AuthCard
      title="Create your inbox"
      subtitle="Free to start. Forward what you already get."
      eyebrowLabel="Start seeing patterns"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm intent="signup" redirectTo={redirectTo} />
    </AuthCard>
  );
}
