"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/observability/logger";
import { ErrorCard } from "@/components/ui/error-card";

/** Dashboard route error boundary — captures to Sentry, offers retry (Prompt 39/51). */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { event: "dashboard_error_boundary" });
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-12">
      <ErrorCard
        title="Something went wrong"
        body="We hit a snag loading this page. Try again — if it keeps happening, we're already on it."
        onRetry={reset}
      />
    </div>
  );
}
