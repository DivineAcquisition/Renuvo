"use client";

import { useCompany } from "@/components/app/company";
import { Lock } from "@/components/icons";
import { sectionById } from "@/lib/app/settings";

/** Pages everyone may read but only the Owner may change say so once, at the top, to everyone else. */
const OWNER_EDITS = new Set(["business", "people", "agents", "dispatch", "recruiting", "integrations", "compliance", "agreements", "ai"]);

export function ViewOnlyNote({ id }: { id: string }) {
  const { role } = useCompany();
  const section = sectionById(id);
  if (!section || role === "owner" || !OWNER_EDITS.has(id)) return null;
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">
      <Lock aria-hidden className="size-3.5" />
      {section.access}
    </p>
  );
}
