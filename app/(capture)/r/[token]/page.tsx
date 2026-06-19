import type { Metadata } from "next";

// A tokenized signup link must never be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Public recurring-signup capture page (served on r.renuvo.io/{token}).
 * Contents are built in Prompt 18 — this is the routing placeholder only.
 */
export default function CapturePage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Renuvo<span className="align-super text-base">™</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your recurring-service signup is on the way. This page is coming soon.
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground/70">
          ref: {params.token}
        </p>
      </div>
    </main>
  );
}
