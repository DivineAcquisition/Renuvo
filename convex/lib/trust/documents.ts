/**
 * The public documents and their versions: the one list the record and the website share. The text of
 * each version lives in the website (src/lib/trust/documents). A version is never edited after it is
 * published: a change is a new version with a new id, so an acceptance always points at the exact text.
 *
 * Pure: no Convex or Next.js imports, so both sides can use it.
 */
export const DOCUMENT_KINDS = ["terms", "privacy", "cookies", "messaging", "security"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type DocumentVersion = {
  /** Never reused, for example "terms-2026-11-16". */
  id: string;
  kind: DocumentKind;
  title: string;
  /** The date it takes effect, YYYY-MM-DD. Chosen by the owner, not computed. */
  effectiveOn: string;
  /** What changed from the version before, in one line. */
  summary: string;
};

export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Notice",
  cookies: "Cookies and Tracking",
  messaging: "Messaging Practices",
  security: "Security Overview",
};

/** Every version ever published, oldest first within a kind. */
export const DOCUMENT_VERSIONS: readonly DocumentVersion[] = [
  { id: "terms-2026-11-16", kind: "terms", title: DOCUMENT_TITLES.terms, effectiveOn: "2026-11-16", summary: "First version." },
  { id: "privacy-2026-11-16", kind: "privacy", title: DOCUMENT_TITLES.privacy, effectiveOn: "2026-11-16", summary: "First version." },
  { id: "cookies-2026-11-16", kind: "cookies", title: DOCUMENT_TITLES.cookies, effectiveOn: "2026-11-16", summary: "First version." },
  { id: "messaging-2026-11-16", kind: "messaging", title: DOCUMENT_TITLES.messaging, effectiveOn: "2026-11-16", summary: "First version." },
  { id: "security-2026-11-16", kind: "security", title: DOCUMENT_TITLES.security, effectiveOn: "2026-11-16", summary: "First version." },
];

/** The newest version of a kind: the one in force and the one a person accepts. */
export function currentVersion(kind: DocumentKind): DocumentVersion {
  const rows = DOCUMENT_VERSIONS.filter((row) => row.kind === kind);
  return rows[rows.length - 1];
}

export function versionById(id: string): DocumentVersion | null {
  return DOCUMENT_VERSIONS.find((row) => row.id === id) ?? null;
}
