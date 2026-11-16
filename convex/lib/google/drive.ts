/**
 * Drive, Docs and Sheets with the drive.file scope: Selestial sees only files the Owner picked (Google
 * Picker) and files Selestial created. Picking a folder grants the folder, not the files already in it,
 * so a folder's contents are listed to show what is actually readable instead of assuming.
 *
 * Every file Selestial creates carries appProperties.selestialKey, so a retry or an uncertain upload is
 * found and reused instead of making a second copy.
 */
import { GoogleError, googleCall, type Fetch } from "./http";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER = "application/vnd.google-apps.folder";
export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";

export type DriveFile = { id: string; name: string; mimeType: string; trashed?: boolean; webViewLink?: string; modifiedTime?: string; capabilities?: { canEdit?: boolean; canAddChildren?: boolean; canDownload?: boolean } };

const FIELDS = "id,name,mimeType,trashed,webViewLink,modifiedTime,capabilities(canEdit,canAddChildren,canDownload)";

export async function getFile(token: string, id: string, fetcher?: Fetch): Promise<DriveFile> {
  return googleCall<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`, token, { fetcher });
}

/** What inside a folder Selestial can actually see. With drive.file this is usually less than the folder holds. */
export async function listChildren(token: string, folderId: string, fetcher?: Fetch): Promise<DriveFile[]> {
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`;
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const body = await googleCall<{ files?: DriveFile[]; nextPageToken?: string }>(`${API}/files?q=${encodeURIComponent(q)}&pageSize=100&fields=${encodeURIComponent(`nextPageToken,files(${FIELDS})`)}&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token, { fetcher });
    out.push(...(body.files ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return out;
}

/** A file's text: Google Docs as plain text, Sheets as CSV, text files as they are. Anything else is not read. */
export async function readText(token: string, file: DriveFile, fetcher?: Fetch, maxChars = 200_000): Promise<string | null> {
  let url: string | null = null;
  if (file.mimeType === GOOGLE_DOC) url = `${API}/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`;
  else if (file.mimeType === GOOGLE_SHEET) url = `${API}/files/${encodeURIComponent(file.id)}/export?mimeType=text/csv`;
  else if (file.mimeType.startsWith("text/") || file.mimeType === "application/json") url = `${API}/files/${encodeURIComponent(file.id)}?alt=media`;
  if (!url) return null;
  const response = await (fetcher ?? fetch)(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!response) throw new GoogleError("server", "Google did not answer.");
  if (response.status === 401) throw new GoogleError("auth", "Not authorized.", 401);
  if (response.status === 403 || response.status === 404) throw new GoogleError(response.status === 404 ? "not_found" : "forbidden", "Selestial cannot read this file.", response.status);
  if (!response.ok) throw new GoogleError("server", `HTTP ${response.status}`, response.status);
  return (await response.text()).slice(0, maxChars);
}

export async function findByKey(token: string, key: string, fetcher?: Fetch): Promise<DriveFile | null> {
  const q = `appProperties has { key='selestialKey' and value='${key.replace(/'/g, "")}' } and trashed=false`;
  const body = await googleCall<{ files?: DriveFile[] }>(`${API}/files?q=${encodeURIComponent(q)}&pageSize=2&fields=${encodeURIComponent(`files(${FIELDS})`)}&supportsAllDrives=true&includeItemsFromAllDrives=true`, token, { fetcher });
  return body.files?.[0] ?? null;
}

const boundary = () => `selestial${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * Uploads a file into a folder, converting it to a Google Doc or Sheet when `as` is given. The key makes
 * it findable, so a second attempt reuses the first file.
 */
export async function upload(token: string, input: { name: string; parentId: string; key: string; mimeType: string; bytes: Uint8Array; as?: string; description?: string }, fetcher?: Fetch): Promise<DriveFile> {
  const sep = boundary();
  const metadata = { name: input.name.slice(0, 250), parents: [input.parentId], mimeType: input.as ?? input.mimeType, description: input.description?.slice(0, 500), appProperties: { selestialKey: input.key } };
  const head = new TextEncoder().encode(`--${sep}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${sep}\r\nContent-Type: ${input.mimeType}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${sep}--`);
  const body = new Uint8Array(head.length + input.bytes.length + tail.length);
  body.set(head, 0);
  body.set(input.bytes, head.length);
  body.set(tail, head.length + input.bytes.length);
  return googleCall<DriveFile>(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`, token, { method: "POST", rawBody: body, headers: { "Content-Type": `multipart/related; boundary=${sep}` }, fetcher, timeoutMs: 120_000 });
}

/** Replaces a file Selestial made with new content, keeping its id and link. */
export async function replaceContent(token: string, fileId: string, mimeType: string, bytes: Uint8Array, fetcher?: Fetch): Promise<DriveFile> {
  return googleCall<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`, token, { method: "PATCH", rawBody: bytes.slice().buffer as ArrayBuffer, headers: { "Content-Type": mimeType }, fetcher, timeoutMs: 120_000 });
}

// ── Sheets ──

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/** Writes rows to the first sheet of a spreadsheet Selestial may edit, replacing what was there. */
export async function writeRows(token: string, spreadsheetId: string, rows: (string | number)[][], fetcher?: Fetch): Promise<{ updatedCells: number }> {
  await googleCall(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/A1:ZZ100000:clear`, token, { method: "POST", body: {}, fetcher });
  const result = await googleCall<{ updatedCells?: number }>(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/A1?valueInputOption=RAW`, token, { method: "PUT", body: { range: "A1", majorDimension: "ROWS", values: rows }, fetcher });
  return { updatedCells: result.updatedCells ?? 0 };
}

/** CSV with quoting, for creating a Sheet by conversion. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((cell) => {
    const text = String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\n");
}

/** Minimal, safe HTML from Markdown-like agreement text, for conversion to a Google Doc. */
export function markdownToHtml(markdown: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => {
      const h1 = /^#\s+(.*)$/.exec(block);
      const h2 = /^##\s+(.*)$/.exec(block);
      if (h1) return `<h1>${escape(h1[1])}</h1>`;
      if (h2) return `<h2>${escape(h2[1])}</h2>`;
      return `<p>${escape(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("")}</body></html>`;
}
