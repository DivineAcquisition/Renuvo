import Link from "next/link";
import { Suspense } from "react";

import { missingSetup, NotSetUp } from "@/components/app/not-set-up";
import { Logo } from "@/components/brand/logo";

/** The frame around Clerk's sign-in and sign-up forms. */
export function AuthScreen({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  const missing = missingSetup();
  if (missing.length > 0) {
    return <NotSetUp title="Sign-in is not set up yet" body="Selestial signs people in with Clerk. These settings are missing on this deployment:" items={missing} />;
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-12">
      <Link href="/" aria-label="Selestial home">
        <Logo />
      </Link>
      <div className="text-center">
        <h1 className="font-heading text-2xl tracking-tight text-strong">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
      </div>
      {/* Clerk's forms read the request, so they render inside a boundary. */}
      <Suspense fallback={<div className="h-80 w-full max-w-sm animate-pulse rounded-2xl border border-border bg-muted" />}>{children}</Suspense>
    </main>
  );
}
