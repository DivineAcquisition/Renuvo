"use client";

import { Notice, Page } from "@/components/cleaner/shell";

/** A link that names nothing, or a page that could not load. The same words either way: nothing about why. */
export default function CleanerError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Page company={null} title="This link can't be opened">
      <Notice tone="warn" title="This link is not valid, or the page could not load" testId="state-invalid">
        Check that you opened the full link from your text message. If it still does not work, ask the office to send a new one.
      </Notice>
      <button type="button" onClick={reset} className="min-h-12 w-full rounded-xl border border-border px-4 text-base font-semibold">
        Try again
      </button>
    </Page>
  );
}
