import type { Metadata } from "next";

import { DocumentView } from "@/components/trust/document";
import { PublicPage } from "@/components/trust/public-page";
import { textFor } from "@/lib/trust/documents";
import { loadPublicTrust } from "@/lib/trust/public";

import { currentVersion, DOCUMENT_VERSIONS, type DocumentKind } from "../../../convex/lib/trust/documents";

export function documentMetadata(kind: DocumentKind, path: string): Metadata {
  const version = currentVersion(kind);
  return { title: version.title, description: textFor(kind).lead, alternates: { canonical: path } };
}

/**
 * One public document page. The text is the current version's, from the code. Whether it is in force
 * comes from the trust records: a version staff have not published, or have withdrawn, is never shown
 * as if it applied.
 */
export async function DocumentPage({ kind, extra }: { kind: DocumentKind; extra?: React.ReactNode }) {
  const trust = await loadPublicTrust();
  const version = currentVersion(kind);
  const publication = trust.publications.find((row) => row.documentId === version.id);
  const available = publication?.status === "published";
  const contact = kind === "privacy" || kind === "cookies" ? trust.settings.contacts.privacy : kind === "security" ? trust.settings.contacts.security : (trust.settings.contacts.support ?? trust.settings.contacts.privacy);
  const history = DOCUMENT_VERSIONS.filter((row) => row.kind === kind && trust.publications.some((item) => item.documentId === row.id && item.status === "published"));
  return (
    <PublicPage trust={trust}>
      <DocumentView text={textFor(kind)} version={version} history={history.length > 0 ? history : [version]} available={available} contact={contact} extra={available ? extra : undefined} />
    </PublicPage>
  );
}
