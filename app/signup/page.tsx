import { AuthCard, AuthScaffold } from "@/components/auth/auth-scaffold";
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
    <AuthScaffold
      eyebrow="Start free"
      headline={
        <>
          Forward the noise.
          <br />
          We’ll show the pattern.
        </>
      }
      subline="No CRM. No new habit. Your Renuvo inbox is ready the moment you sign up."
    >
      <AuthCard>
        <p className="auth-eyebrow hidden lg:block">Start seeing patterns</p>
        <h1 className="auth-title">Create your inbox</h1>
        <p className="auth-subtitle">Free to start. Forward what you already get.</p>
        <div className="auth-desk-body">
          <AuthForm intent="signup" redirectTo={redirectTo} />
        </div>
      </AuthCard>
    </AuthScaffold>
  );
}
