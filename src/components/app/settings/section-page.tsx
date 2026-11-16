import { SectionMark } from "@/components/app/settings/marks";
import { sectionById } from "@/lib/app/settings";

/** A section's title and purpose come from the catalog, so a page never words them differently. */
export function SectionPage({ id, children }: { id: string; children: React.ReactNode }) {
  const section = sectionById(id);
  if (!section) throw new Error(`No settings section named ${id}`);
  return (
    <>
      <header className="mb-5 flex items-start gap-3.5 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
        <SectionMark id={section.id} size="lg" />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl tracking-tight text-strong">{section.label}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{section.purpose}</p>
          <p className="mt-2 inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{section.access}</p>
        </div>
      </header>
      {children}
    </>
  );
}
