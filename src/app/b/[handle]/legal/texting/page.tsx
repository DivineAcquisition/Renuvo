import type { Metadata } from "next";

import { LegalBody, Missing, PageFrame } from "@/components/texting/legal-page";
import { loadTextingPage } from "@/lib/texting/public";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadTextingPage((await params).handle.toLowerCase(), "terms");
  return { title: page ? `Texting terms · ${page.company.name}` : "Texting terms" };
}

/** A company's own texting terms, published from Set up business texting. */
export default async function Page({ params }: Props) {
  const page = await loadTextingPage((await params).handle.toLowerCase(), "terms");
  if (!page) return <Missing />;
  return (
    <PageFrame company={page.company}>
      <LegalBody body={page.body} publishedAt={page.publishedAt} />
    </PageFrame>
  );
}
