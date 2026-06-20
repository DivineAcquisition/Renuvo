"use client";

import { Button } from "./button";

/**
 * Inline error state for a single content region (Prompt 51) — for failures that
 * shouldn't take down the whole page. Route-level throws hit error.tsx + Sentry.
 */
export function ErrorCard({
  title = "Couldn't load this",
  body = "Something went wrong. Please try again.",
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-10 text-center">
      <p className="font-display text-base font-semibold text-destructive">
        {title}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
