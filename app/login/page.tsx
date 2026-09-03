import { AuthCard, AuthScaffold } from "@/components/auth/auth-scaffold";
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
    <AuthScaffold
      eyebrow="Welcome back"
      headline={
        <>
          See the pattern
          <br />
          before it costs you.
        </>
      }
      subline={`Sign in to ${APP_NAME} and pick up where your inbox left off.`}
    >
      <AuthCard>
        <p className="auth-eyebrow hidden lg:block">Private access</p>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to continue to {APP_NAME}</p>
        <div className="auth-desk-body">
          <AuthForm intent="login" redirectTo={redirectTo} />
        </div>
      </AuthCard>
    </AuthScaffold>
  );
}
