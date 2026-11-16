/**
 * The hiring mailbox, behind one interface. A connector lists message headers after a cursor and fetches
 * one message's body. It can read; it cannot send, delete or mark anything.
 *
 * Gmail and Microsoft 365 connectors are not built: each needs an OAuth app and a place to keep a
 * company's refresh token, neither of which exists yet (docs/recruiter/05-assumptions.md). Until then
 * the mock is the only connector, so every path above this interface is exercised without a real inbox.
 */
import type { MessageBody, MessageHeader } from "./mail";

export type MailboxScope = { address: string; folder?: string; after: number };

export type ListResult = { headers: MessageHeader[]; /** Where to continue from. Unchanged when nothing new came. */ cursor: string | null; more: boolean };

/** The connection's authorization ended. Only the Owner can fix it. */
export class MailboxAuthError extends Error {}
/** The provider failed for now. Trying again later may work. */
export class MailboxProviderError extends Error {}

export interface MailboxConnector {
  provider: string;
  /** Headers only, oldest first, after `cursor`. Never a body. */
  list(scope: MailboxScope, cursor: string | null, limit: number): Promise<ListResult>;
  fetch(scope: MailboxScope, id: string): Promise<MessageBody | null>;
}

// ── The mock ────────────────────────────────────────────────────────────────────────────────────

type MockInbox = { messages: MessageBody[]; fail: "auth" | "provider" | null; fetched: string[]; listed: number };
const inboxes = new Map<string, MockInbox>();

/** The test inbox for an address. Tests put messages in and set failures here. */
export function mockInbox(address: string): MockInbox {
  const key = address.toLowerCase();
  if (!inboxes.has(key)) inboxes.set(key, { messages: [], fail: null, fetched: [], listed: 0 });
  return inboxes.get(key)!;
}

export function resetMockInboxes() {
  inboxes.clear();
}

export const mockConnector: MailboxConnector = {
  provider: "mock",
  async list(scope, cursor, limit) {
    const inbox = mockInbox(scope.address);
    inbox.listed += 1;
    if (inbox.fail === "auth") throw new MailboxAuthError("mock: authorization expired");
    if (inbox.fail === "provider") throw new MailboxProviderError("mock: provider unavailable");
    const start = cursor ? Number(cursor) : 0;
    const eligible = inbox.messages.slice(start, start + limit);
    const headers = eligible
      .filter((message) => message.receivedAt >= scope.after)
      .map(({ id, threadId, from, replyTo, subject, receivedAt }) => ({ id, threadId, from, replyTo, subject, receivedAt }));
    const next = start + eligible.length;
    return { headers, cursor: String(next), more: next < inbox.messages.length };
  },
  async fetch(scope, id) {
    const inbox = mockInbox(scope.address);
    if (inbox.fail === "auth") throw new MailboxAuthError("mock: authorization expired");
    if (inbox.fail === "provider") throw new MailboxProviderError("mock: provider unavailable");
    inbox.fetched.push(id);
    return inbox.messages.find((message) => message.id === id) ?? null;
  },
};

export function connectorFor(provider: string): MailboxConnector | null {
  return provider === "mock" ? mockConnector : null;
}
