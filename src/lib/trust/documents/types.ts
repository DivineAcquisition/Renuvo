/**
 * The shape every public document is written in. Text only: no HTML. A paragraph may contain links
 * written as [label](/path) or [label](mailto:address); the page turns those into links and nothing else.
 */
import type { DocumentKind } from "../../../../convex/lib/trust/documents";

export type Block = { p: string } | { list: string[] } | { note: string } | { table: { head: string[]; rows: string[][] } };

export type Section = { id: string; heading: string; blocks: Block[] };

export type DocumentText = {
  /** Matches an id in convex/lib/trust/documents.ts. */
  versionId: string;
  kind: DocumentKind;
  /** One or two sentences under the title. */
  lead: string;
  sections: Section[];
};

/** Facts every document may use. Change them here, not in a document. */
export const FACTS = {
  entity: "Divine Agency LLC",
  address: "7404 Executive Place, Lanham, MD 20706, United States",
  governingPlace: "the State of Maryland, United States",
  product: "Selestial",
  site: "selestial.io",
  privacyEmail: "privacy@selestial.io",
  securityEmail: "security@selestial.io",
  supportEmail: "support@selestial.io",
} as const;
