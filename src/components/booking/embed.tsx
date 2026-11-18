"use client";

/**
 * The embeddable entry: a small ZIP box a company can put on its own website. It holds no session and no
 * token; it sends the visitor to the full booking page in a new tab with the ZIP code filled in.
 */
import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { resolveTheme } from "./theme";

export function BookingEmbed({ handle, slug }: { handle: string; slug: string }) {
  const page = useQuery(api.bookingPublic.page, { handle, slug });
  const [zip, setZip] = useState("");
  if (page === undefined) return <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 motion-reduce:animate-none" aria-busy="true" />;
  if (page === null) return <p className="p-4 text-sm text-zinc-600">Online booking isn&apos;t available right now.</p>;
  const theme = resolveTheme(page.definition.theme, page.company);
  const copy = page.definition.steps.find((s) => s.id === "location")!.copy;
  const target = `/b/${handle}/${slug}${zip.trim() ? `?zip=${encodeURIComponent(zip.trim())}` : ""}`;
  return (
    <div className="bk min-h-0 bg-transparent p-2" style={theme.style}>
      <form
        className="bk-card space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          window.open(target, "_blank", "noopener");
        }}
      >
        <p className="text-sm font-semibold">{page.company.name}</p>
        <p className="text-lg font-semibold tracking-tight">{copy.title}</p>
        <label htmlFor="bk-embed-zip" className="block text-sm font-medium">
          Your ZIP code
        </label>
        <div className="flex gap-2">
          <input id="bk-embed-zip" className="bk-input" inputMode="numeric" maxLength={10} value={zip} onChange={(e) => setZip(e.target.value.replace(/[^\w -]/g, ""))} placeholder="12345" />
          <button type="submit" className="bk-btn h-12 shrink-0 px-5">
            {copy.button || "Book"}
          </button>
        </div>
      </form>
    </div>
  );
}
