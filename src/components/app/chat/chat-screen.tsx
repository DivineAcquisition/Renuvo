"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useChat } from "@/components/app/chat/chat-context";
import { SessionActions, SessionSwitcher, StateBadge, type SessionRow } from "@/components/app/chat/sessions";
import { ChatThread } from "@/components/app/chat/thread";
import { DocumentWorkspace } from "@/components/app/chat/workspace";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { Brain, Check, Plus, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/** What the company has confirmed, and what chats proposed for the Owner to confirm. */
function CompanyKnowledge() {
  const { companyId } = useCompany();
  const knowledge = useQuery(api.chat.knowledge, { companyId });
  const decide = useMutation(api.chat.decideKnowledge);
  const [error, setError] = useState<string | null>(null);
  if (!knowledge || (knowledge.confirmed.length === 0 && knowledge.proposed.length === 0)) return null;
  const answer = (knowledgeId: string, status: "confirmed" | "rejected") => {
    setError(null);
    decide({ companyId, knowledgeId: knowledgeId as never, status }).catch((caught: unknown) => setError(messageOf(caught)));
  };
  return (
    <section aria-label="Company knowledge" className="rounded-2xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
        <Brain className="size-4 text-brand-300" aria-hidden /> Company knowledge
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">Chat uses only what the Owner confirmed. It is knowledge for answers, not an operating rule.</p>
      {knowledge.proposed.length ? (
        <ul className="mt-3 grid gap-1.5">
          {knowledge.proposed.map((row) => (
            <li key={row.knowledgeId} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning/50 bg-warning/5 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 text-strong">{row.text}</span>
              {knowledge.canDecide ? (
                <span className="flex gap-1">
                  <Button size="xs" variant="secondary" onClick={() => answer(row.knowledgeId, "confirmed")}>
                    <Check className="size-3" aria-hidden /> Confirm
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => answer(row.knowledgeId, "rejected")}>
                    <X className="size-3" aria-hidden /> Not this
                  </Button>
                </span>
              ) : (
                <span className="text-[11px] text-warning-foreground">Waiting for the Owner</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {knowledge.confirmed.length ? (
        <ul className="mt-3 grid gap-1 text-sm text-strong">
          {knowledge.confirmed.slice(0, 12).map((row) => (
            <li key={row.knowledgeId} className="flex items-start gap-2">
              <Check className="mt-1 size-3.5 shrink-0 text-success" aria-hidden />
              <span className="min-w-0 flex-1">{row.text}</span>
              {knowledge.canDecide ? (
                <button type="button" onClick={() => answer(row.knowledgeId, "rejected")} className="text-[11px] text-muted-foreground hover:text-strong">
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Header({ conversationId }: { conversationId: string | null }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const thread = useQuery(api.chat.thread, conversationId ? { companyId, conversationId } : "skip");
  const row: SessionRow | null = thread ? (thread.conversation as SessionRow) : null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
      <div className="min-w-0 basis-full xl:basis-0 xl:flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate font-heading text-xl tracking-tight text-strong">{row ? row.title : "Chat"}</h1>
          {row && row.state !== "idle" ? <StateBadge state={row.state} /> : null}
          {row?.shelf === "archived" ? <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Archived</span> : null}
        </div>
      </div>
      <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
          <SessionSwitcher label="Chats" current={conversationId} onPick={(id) => router.push(`/app/chat/${id}`)} onNew={() => router.push("/app/chat")} />
        </div>
        <Link href="/app/chats" aria-label="Search all chats" className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
          <Search className="size-4" aria-hidden />
        </Link>
        {conversationId ? (
          <Button variant="outline" onClick={() => router.push("/app/chat")} aria-label="New chat">
            <Plus className="size-4" aria-hidden />
            <span className="hidden sm:inline">New chat</span>
          </Button>
        ) : null}
        {row ? <SessionActions row={row} onDeleted={() => router.push("/app/chat")} /> : null}
      </div>
    </div>
  );
}

/**
 * The full conversation workspace. The open chat is shared with the side panel, so expanding the panel
 * lands here on the same conversation, and a draft opens in a column beside it (full screen on a phone).
 */
export function ChatScreen({ conversationId }: { conversationId: string | null }) {
  const router = useRouter();
  const { setConversationId, artifactId, openArtifact } = useChat();
  useEffect(() => {
    if (conversationId) setConversationId(conversationId);
  }, [conversationId, setConversationId]);

  return (
    <div className={cn("-mb-20 grid min-h-[calc(100dvh-6.5rem)] gap-0", artifactId ? "lg:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)] lg:gap-5" : "")}>
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col">
        <Header conversationId={conversationId} />
        <ChatThread
          conversationId={conversationId}
          autoFocus
          onStarted={(id) => {
            setConversationId(id);
            router.push(`/app/chat/${id}`);
          }}
        />
        {conversationId ? null : (
          <div className="pb-6">
            <CompanyKnowledge />
          </div>
        )}
      </div>
      {artifactId ? (
        <div className="fixed inset-0 z-50 flex flex-col lg:sticky lg:top-20 lg:z-auto lg:h-[calc(100dvh-7rem)] lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border">
          <DocumentWorkspace artifactId={artifactId} onClose={() => openArtifact(null)} />
        </div>
      ) : null}
    </div>
  );
}
