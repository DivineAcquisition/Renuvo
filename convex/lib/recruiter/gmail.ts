/**
 * Gmail, behind the MailboxConnector interface (mailbox.ts), and Gmail sending for a company that has
 * connected its own mailbox.
 *
 * Access is the company's own authorization: OAuth with the scopes below, a refresh token stored
 * encrypted (secrets.ts), an access token fetched for each run and never stored.
 *
 * Reading stays inside what the Owner chose: mail received from `processFrom` on, and inside one label
 * when the Owner named one. Headers are listed first; a body is fetched only for a message Recruiter has
 * already judged from its sender and subject to be hiring mail.
 *
 * Incremental: the first run scans with a search query and records Gmail's history id; later runs read
 * only what was added since that id. If Gmail no longer has that history (it keeps about a week), the run
 * scans again from `processFrom`; filing ignores what it already has.
 *
 * NOT VERIFIED against Gmail itself in this build: no Google OAuth app exists yet. Request and response
 * shapes follow the Gmail API v1 reference as understood when this was written.
 */
import { MailboxAuthError, MailboxProviderError, type ListResult, type MailboxConnector, type MailboxScope } from "./mailbox";
import type { MessageAttachment, MessageBody, MessageHeader } from "./mail";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "openid", "email"] as const;

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN = "https://oauth2.googleapis.com/token";
const MAX_TEXT_ATTACHMENT = 200_000;

type Fetch = typeof fetch;
type Cursor = { mode: "scan"; historyId: string; pageToken?: string } | { mode: "history"; historyId: string; pageToken?: string; startHistoryId?: string };

export type GoogleApp = { clientId: string; clientSecret: string };

export function googleApp(): GoogleApp | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Trades a refresh token for an access token. An authorization that has ended is a MailboxAuthError. */
export async function accessToken(app: GoogleApp, refreshToken: string, fetcher: Fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
    });
  } catch {
    throw new MailboxProviderError("google: no answer");
  }
  const body = (await response.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (response.ok && body?.access_token) return body.access_token;
  if (body?.error === "invalid_grant" || response.status === 400 || response.status === 401) throw new MailboxAuthError("google: authorization ended");
  throw new MailboxProviderError("google: token refresh failed");
}

/** Exchanges the code Google returned after the Owner agreed. */
export async function exchangeCode(app: GoogleApp, code: string, redirectUri: string, fetcher: Fetch = fetch): Promise<{ refreshToken: string; accessToken: string; scope: string } | null> {
  const response = await fetcher(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { refresh_token?: string; access_token?: string; scope?: string } | null;
  if (!body?.refresh_token || !body.access_token) return null;
  return { refreshToken: body.refresh_token, accessToken: body.access_token, scope: body.scope ?? "" };
}

export function authorizationUrl(app: GoogleApp, input: { redirectUri: string; state: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    // Asked each time, so Google always returns a refresh token and the Owner sees what is being granted.
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function call<T>(fetcher: Fetch, token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  } catch {
    throw new MailboxProviderError("gmail: no answer");
  }
  if (response.status === 401 || response.status === 403) throw new MailboxAuthError("gmail: not authorized");
  if (response.status === 404) throw new NotFound();
  if (!response.ok) throw new MailboxProviderError(`gmail: ${response.status}`);
  return (await response.json()) as T;
}

class NotFound extends Error {}

type Header = { name: string; value: string };
type Part = { mimeType?: string; filename?: string; headers?: Header[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[] };
type GmailMessage = { id: string; threadId?: string; internalDate?: string; payload?: Part };

function header(headers: Header[] | undefined, name: string): string | undefined {
  return headers?.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value;
}

function decode(data: string): string {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function toHeader(message: GmailMessage): MessageHeader {
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId,
    from: header(headers, "From") ?? "",
    replyTo: header(headers, "Reply-To"),
    subject: header(headers, "Subject") ?? "",
    receivedAt: Number(message.internalDate ?? 0),
  };
}

/** Gmail's search words for a label name. */
function labelQuery(folder: string | undefined): string {
  return folder ? ` label:"${folder.replace(/"/g, "")}"` : "";
}

export function gmailConnector(input: { token: string; fetch?: Fetch }): MailboxConnector {
  const fetcher = input.fetch ?? fetch;
  const token = input.token;
  const labelIds = new Map<string, string | null>();

  async function labelId(name: string): Promise<string | null> {
    if (!labelIds.has(name)) {
      const { labels } = await call<{ labels?: { id: string; name: string }[] }>(fetcher, token, "/labels");
      labelIds.set(name, labels?.find((row) => row.name.toLowerCase() === name.toLowerCase())?.id ?? null);
    }
    return labelIds.get(name)!;
  }

  async function headersFor(ids: string[], scope: MailboxScope): Promise<MessageHeader[]> {
    const out: MessageHeader[] = [];
    for (const id of ids) {
      try {
        const message = await call<GmailMessage>(fetcher, token, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject`);
        const row = toHeader(message);
        if (row.receivedAt >= scope.after) out.push(row);
      } catch (error) {
        // A message deleted between listing and reading is simply not there.
        if (!(error instanceof NotFound)) throw error;
      }
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  async function scan(scope: MailboxScope, cursor: Extract<Cursor, { mode: "scan" }>, limit: number): Promise<ListResult> {
    const q = `after:${Math.floor(scope.after / 1000)}${labelQuery(scope.folder)}`;
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(fetcher, token, `/messages?${new URLSearchParams({ q, maxResults: String(limit), ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}) })}`);
    const headers = await headersFor((page.messages ?? []).map((row) => row.id), scope);
    const next: Cursor = page.nextPageToken ? { mode: "scan", historyId: cursor.historyId, pageToken: page.nextPageToken } : { mode: "history", historyId: cursor.historyId };
    return { headers, cursor: JSON.stringify(next), more: Boolean(page.nextPageToken) };
  }

  return {
    provider: "gmail",
    async list(scope, raw, limit) {
      let cursor: Cursor | null = null;
      try {
        cursor = raw ? (JSON.parse(raw) as Cursor) : null;
      } catch {
        cursor = null;
      }
      if (!cursor) {
        // The history id is taken before the scan, so nothing that arrives during the scan is missed.
        const profile = await call<{ historyId: string }>(fetcher, token, "/profile");
        cursor = { mode: "scan", historyId: profile.historyId };
      }
      if (cursor.mode === "scan") return scan(scope, cursor, limit);

      const label = scope.folder ? await labelId(scope.folder) : null;
      if (scope.folder && !label) throw new MailboxProviderError("gmail: the label was not found");
      const start = cursor.startHistoryId ?? cursor.historyId;
      try {
        const page = await call<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId?: string; nextPageToken?: string }>(
          fetcher,
          token,
          `/history?${new URLSearchParams({ startHistoryId: start, historyTypes: "messageAdded", maxResults: String(limit), ...(label ? { labelId: label } : {}), ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}) })}`,
        );
        const ids = [...new Set((page.history ?? []).flatMap((entry) => (entry.messagesAdded ?? []).map((added) => added.message.id)))];
        const headers = await headersFor(ids, scope);
        const next: Cursor = page.nextPageToken ? { mode: "history", historyId: page.historyId ?? cursor.historyId, pageToken: page.nextPageToken, startHistoryId: start } : { mode: "history", historyId: page.historyId ?? cursor.historyId };
        return { headers, cursor: JSON.stringify(next), more: Boolean(page.nextPageToken) };
      } catch (error) {
        if (!(error instanceof NotFound)) throw error;
        // Gmail no longer keeps history that old. Scan again; filing skips what it already has.
        const profile = await call<{ historyId: string }>(fetcher, token, "/profile");
        return scan(scope, { mode: "scan", historyId: profile.historyId }, limit);
      }
    },
    async fetch(_scope, id) {
      let message: GmailMessage;
      try {
        message = await call<GmailMessage>(fetcher, token, `/messages/${encodeURIComponent(id)}?format=full`);
      } catch (error) {
        if (error instanceof NotFound) return null;
        throw error;
      }
      let plain = "";
      let html = "";
      const attachments: MessageAttachment[] = [];
      const walk = async (part: Part | undefined) => {
        if (!part) return;
        if (part.filename) {
          const file: MessageAttachment = { name: part.filename, contentType: part.mimeType ?? "application/octet-stream", size: part.body?.size ?? 0 };
          // Only plain text attachments are read. PDF and Word files are listed, not opened.
          if (part.mimeType === "text/plain" && part.body?.attachmentId && file.size <= MAX_TEXT_ATTACHMENT) {
            const data = await call<{ data?: string }>(fetcher, token, `/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`);
            if (data.data) file.text = decode(data.data);
          }
          attachments.push(file);
        } else if (part.mimeType === "text/plain" && part.body?.data) plain += decode(part.body.data);
        else if (part.mimeType === "text/html" && part.body?.data) html += decode(part.body.data);
        for (const child of part.parts ?? []) await walk(child);
      };
      await walk(message.payload);
      return { ...toHeader(message), text: plain || html, attachments } satisfies MessageBody;
    },
  };
}

// ── Sending from the company's own mailbox ─────────────────────────────────────────────────────────

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** A header value with anything outside plain ASCII encoded, so a name cannot break the message. */
function encodeWord(value: string): string {
  const clean = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const bytes = new TextEncoder().encode(clean);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The message as Gmail wants it: RFC 5322, base64url. Pure, so it can be checked in a test. */
export function rawMessage(input: { from: string; fromName: string; to: string; replyTo?: string; subject: string; text: string; messageId: string }): string {
  const name = oneLine(input.fromName).replace(/["\\]/g, "");
  const lines = [
    `From: "${encodeWord(name)}" <${oneLine(input.from)}>`,
    `To: <${oneLine(input.to)}>`,
    ...(input.replyTo && input.replyTo !== input.from ? [`Reply-To: <${oneLine(input.replyTo)}>`] : []),
    `Subject: ${encodeWord(input.subject)}`,
    `Message-ID: <${input.messageId.replace(/[^\w.-]/g, "")}@selestial.recruiter>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text.replace(/\r?\n/g, "\r\n"),
  ];
  return base64url(lines.join("\r\n"));
}

export type GmailSendResult = { ok: true; providerMessageId: string; delivered: false } | { ok: false; retryable: boolean; problem: string };

/** Sends one message from the connected mailbox. A dropped connection throws: nobody knows whether it went. */
export async function sendFromGmail(input: { token: string; raw: string; fetch?: Fetch }): Promise<GmailSendResult> {
  const fetcher = input.fetch ?? fetch;
  const response = await fetcher(`${API}/messages/send`, { method: "POST", headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: input.raw }) });
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, providerMessageId: body?.id ?? "unknown", delivered: false };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, retryable: false, problem: "The company's mailbox no longer lets Selestial send. Reconnect it." };
  if (response.status === 429 || response.status >= 500) return { ok: false, retryable: true, problem: "Gmail is busy or unavailable." };
  return { ok: false, retryable: false, problem: "Gmail would not send this message." };
}
