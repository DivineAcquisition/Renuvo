/**
 * The text of every published document version, by version id. A version's text is never edited after
 * it is published: a change is a new file entry under a new id, added to convex/lib/trust/documents.ts.
 */
import { currentVersion, type DocumentKind } from "../../../../convex/lib/trust/documents";
import { COOKIES } from "./cookies";
import { MESSAGING } from "./messaging";
import { PRIVACY } from "./privacy";
import { SECURITY } from "./security";
import { TERMS } from "./terms";
import type { DocumentText } from "./types";

export const DOCUMENT_TEXTS: Record<string, DocumentText> = Object.fromEntries(
  [TERMS, PRIVACY, COOKIES, MESSAGING, SECURITY].map((text) => [text.versionId, text]),
);

/** The text of the version in force for a kind. Throws if a listed version has no text, which is a build mistake. */
export function textFor(kind: DocumentKind): DocumentText {
  const version = currentVersion(kind);
  const text = DOCUMENT_TEXTS[version.id];
  if (!text) throw new Error(`No text for document version ${version.id}.`);
  return text;
}

export type { Block, DocumentText, Section } from "./types";
