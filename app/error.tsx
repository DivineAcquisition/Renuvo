"use client";

import { useEffect } from "react";
import { log } from "@/lib/log";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    log.error("ui.error_boundary", { message: error.message });
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="font-display text-xl font-bold">Something went wrong</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        We hit a snag. Try again, and if it keeps happening we&apos;re already on
        it.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
