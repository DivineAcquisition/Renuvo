/** A stand-in for Google's OAuth token endpoint and the Gmail API, for tests. Nothing reaches the network. */
import type { MessageBody } from "../convex/lib/recruiter/mail";

const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (data: string) => {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type FakeMessage = MessageBody & { labels?: string[]; historyId?: number; pdf?: boolean };

export function fakeGoogle(options: { email?: string; scope?: string } = {}) {
  const state = {
    email: options.email ?? "hiring@alpha-cleaning.test",
    scope: options.scope ?? "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email",
    messages: [] as FakeMessage[],
    historyId: 100,
    /** Below this, history is gone and Gmail answers 404. */
    oldestHistory: 0,
    labels: [{ id: "Label_7", name: "Hiring" }],
    refreshRevoked: false,
    sent: [] as { raw: string; decoded: string }[],
    calls: [] as string[],
    codes: new Set<string>(["good-code"]),
  };
  const add = (message: FakeMessage) => {
    state.historyId += 1;
    state.messages.push({ ...message, historyId: state.historyId });
  };
  const visible = (message: FakeMessage, labelId: string | null) => !labelId || (message.labels ?? []).includes(labelId);

  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    state.calls.push(`${init.method ?? "GET"} ${url.pathname}`);
    if (url.hostname === "oauth2.googleapis.com") {
      const body = new URLSearchParams(String(init.body));
      if (body.get("grant_type") === "authorization_code") {
        if (!state.codes.has(body.get("code") ?? "")) return json(400, { error: "invalid_grant" });
        state.codes.delete(body.get("code")!);
        return json(200, { access_token: "access-1", refresh_token: "refresh-secret-token", scope: state.scope, token_type: "Bearer" });
      }
      if (state.refreshRevoked || body.get("refresh_token") !== "refresh-secret-token") return json(400, { error: "invalid_grant" });
      return json(200, { access_token: "access-2", token_type: "Bearer" });
    }
    if (url.hostname !== "gmail.googleapis.com") return json(404, {});
    const auth = new Headers(init.headers).get("Authorization");
    if (auth !== "Bearer access-1" && auth !== "Bearer access-2") return json(401, {});
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    const params = url.searchParams;
    if (path === "/profile") return json(200, { emailAddress: state.email, historyId: String(state.historyId) });
    if (path === "/labels") return json(200, { labels: state.labels });
    if (path === "/messages/send" && init.method === "POST") {
      const raw = (JSON.parse(String(init.body)) as { raw: string }).raw;
      state.sent.push({ raw, decoded: fromB64url(raw) });
      return json(200, { id: `sent-${state.sent.length}`, threadId: "t" });
    }
    if (path === "/messages") {
      const after = Number(params.get("q")?.match(/after:(\d+)/)?.[1] ?? 0) * 1000;
      const label = params.get("q")?.match(/label:"([^"]+)"/)?.[1];
      const labelId = label ? (state.labels.find((row) => row.name === label)?.id ?? "none") : null;
      const all = state.messages.filter((m) => m.receivedAt >= after && visible(m, labelId)).reverse();
      const start = Number(params.get("pageToken") ?? 0);
      const size = Number(params.get("maxResults") ?? 100);
      const page = all.slice(start, start + size);
      return json(200, { messages: page.map((m) => ({ id: m.id })), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
    }
    if (path === "/history") {
      const startId = Number(params.get("startHistoryId"));
      if (startId < state.oldestHistory) return json(404, {});
      const labelId = params.get("labelId");
      const added = state.messages.filter((m) => (m.historyId ?? 0) > startId && visible(m, labelId));
      return json(200, { history: added.map((m) => ({ messagesAdded: [{ message: { id: m.id } }] })), historyId: String(state.historyId) });
    }
    const attachment = path.match(/^\/messages\/([^/]+)\/attachments\/(.+)$/);
    if (attachment) {
      const message = state.messages.find((m) => m.id === decodeURIComponent(attachment[1]));
      const file = message?.attachments.find((f) => f.name === decodeURIComponent(attachment[2]));
      return file ? json(200, { data: b64url(file.text ?? "") }) : json(404, {});
    }
    const one = path.match(/^\/messages\/([^/]+)$/);
    if (one) {
      const message = state.messages.find((m) => m.id === decodeURIComponent(one[1]));
      if (!message) return json(404, {});
      const headers = [{ name: "From", value: message.from }, { name: "Subject", value: message.subject }, ...(message.replyTo ? [{ name: "Reply-To", value: message.replyTo }] : [])];
      if (params.get("format") === "metadata") return json(200, { id: message.id, threadId: message.threadId, internalDate: String(message.receivedAt), payload: { headers } });
      return json(200, {
        id: message.id,
        threadId: message.threadId,
        internalDate: String(message.receivedAt),
        payload: {
          mimeType: "multipart/mixed",
          headers,
          parts: [
            { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64url(message.text) } }, { mimeType: "text/html", body: { data: b64url(`<p>${message.text}</p>`) } }] },
            ...message.attachments.map((file) => ({ mimeType: file.contentType, filename: file.name, body: { size: file.size, attachmentId: file.name } })),
          ],
        },
      });
    }
    return json(404, {});
  }) as typeof globalThis.fetch;
  return { state, add, fetch };
}
