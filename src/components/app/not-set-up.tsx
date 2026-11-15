import Link from "next/link";

import { Logo } from "@/components/brand/logo";

/** An honest screen for a piece that is not connected yet. It names the piece and never shows made-up data. */
export function NotSetUp({ title, body, items }: { title: string; body: string; items?: string[] }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8">
        <Link href="/" aria-label="Selestial home" className="inline-flex">
          <Logo />
        </Link>
        <h1 className="mt-6 font-heading text-xl tracking-tight text-strong">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {items ? (
          <ul className="mt-4 space-y-1.5 text-sm text-strong">
            {items.map((item) => (
              <li key={item} className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
          Back to selestial.io
        </Link>
      </div>
    </main>
  );
}

export function missingSetup(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  if (!process.env.NEXT_PUBLIC_CONVEX_URL?.trim()) missing.push("NEXT_PUBLIC_CONVEX_URL");
  return missing;
}
