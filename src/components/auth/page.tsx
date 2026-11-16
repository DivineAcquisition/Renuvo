import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { clerkPublishableKey, convexUrl } from "@/lib/app/config";

/** True when this deployment has what sign-in needs. The screens are not drawn without it. */
export function signInConfigured(): boolean {
  return clerkPublishableKey() !== null && convexUrl() !== null;
}

function NotConfigured() {
  return (
    <main className="auth-page flex min-h-dvh items-center justify-center px-5 py-12 text-[#211a35]">
      <div className="auth-card w-full max-w-md p-6 sm:p-8">
        <Link href="/" aria-label="Selestial home" className="inline-flex">
          <Logo />
        </Link>
        <h1 className="mt-6 font-heading text-xl tracking-tight">Sign-in is not set up yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#667085]">This deployment is not connected to its sign-in service or its live record yet, so nobody can sign in here. Nothing is wrong with your account.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-[#5126c7] underline-offset-4 hover:underline">
          Back to selestial.io
        </Link>
      </div>
    </main>
  );
}

function Waiting() {
  return (
    <div className="auth-page flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Loading">
      <div className="auth-card h-80 w-full max-w-[440px] animate-pulse" />
    </div>
  );
}

/** Every sign-in page goes through here: set up first, then the screen, which reads the address bar. */
export function AuthPage({ children }: { children: React.ReactNode }) {
  if (!signInConfigured()) return <NotConfigured />;
  return <Suspense fallback={<Waiting />}>{children}</Suspense>;
}
