import { PageHeader } from "@/components/app/shell";
import { sectionById } from "@/lib/app/settings";

/** A section's title and purpose come from the catalog, so a page never words them differently. */
export function SectionPage({ id, children }: { id: string; children: React.ReactNode }) {
  const section = sectionById(id);
  if (!section) throw new Error(`No settings section named ${id}`);
  return (
    <>
      <PageHeader title={section.label} lead={section.purpose} />
      {children}
    </>
  );
}
