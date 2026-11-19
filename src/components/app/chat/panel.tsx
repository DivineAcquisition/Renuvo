"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { ChatBoundary } from "@/components/app/chat/boundary";
import { useChat } from "@/components/app/chat/chat-context";
import { SessionSwitcher } from "@/components/app/chat/sessions";
import { ChatThread } from "@/components/app/chat/thread";
import { DocumentWorkspace } from "@/components/app/chat/workspace";
import { ArrowUpRight, Plus, Sparkles, X } from "@/components/icons";
import { cn } from "@/lib/utils";

const onChatPage = (pathname: string) => pathname === "/app/chat" || pathname.startsWith("/app/chat/") || pathname === "/app/chats";

/** "Ask Selestial" in the app header. It opens the same chat in a panel that stays open across pages. */
export function AskButton() {
  const { panelOpen, openPanel, closePanel, launcher } = useChat();
  const pathname = usePathname();
  if (onChatPage(pathname)) return null;
  return (
    <button
      ref={launcher}
      type="button"
      onClick={() => (panelOpen ? closePanel() : openPanel())}
      aria-expanded={panelOpen}
      aria-controls="ask-selestial"
      // On a phone the words are hidden, so the button is named for screen readers either way.
      aria-label="Ask Selestial"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500",
        panelOpen ? "border-brand-500/50 bg-brand-500/15 text-brand-300" : "border-brand-500/30 bg-gradient-to-b from-brand-500/10 to-transparent text-strong hover:border-brand-500/60",
      )}
    >
      <Sparkles className="size-4 text-brand-300" aria-hidden />
      <span className="hidden sm:inline">Ask Selestial</span>
    </button>
  );
}

/**
 * The side panel. It is the same conversation as the full page: switching pages keeps it open and its
 * work keeps running on the server; expanding opens that conversation full size.
 */
export function ChatPanel() {
  const { panelOpen, closePanel, conversationId, setConversationId, artifactId, openArtifact } = useChat();
  const pathname = usePathname();
  const panel = useRef<HTMLElement>(null);
  const hidden = onChatPage(pathname);

  useEffect(() => {
    if (!panelOpen || hidden) return;
    const area = panel.current?.querySelector("textarea");
    area?.focus();
  }, [panelOpen, hidden]);

  return (
    <>
      {panelOpen && !hidden ? (
        <aside
          id="ask-selestial"
          ref={panel}
          aria-label="Ask Selestial"
          className="live-enter fixed inset-0 z-40 flex flex-col bg-background sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[27rem] sm:border-l sm:border-border sm:shadow-[-24px_0_60px_-30px_rgba(27,14,69,0.45)]"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              const target = event.target as HTMLElement;
              if (target.closest("[role=menu],[role=listbox]")) return;
              closePanel();
            }
          }}
        >
          <header className="flex flex-col gap-2 border-b border-border px-3 pt-3 pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4.5 text-brand-300" aria-hidden />
              <h2 className="flex-1 font-heading text-base tracking-tight text-strong">Ask Selestial</h2>
              <Link
                href={conversationId ? `/app/chat/${conversationId}` : "/app/chat"}
                onClick={closePanel}
                aria-label="Open this chat full size"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
              <button type="button" onClick={closePanel} aria-label="Close Ask Selestial" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <ChatBoundary compact>
                <SessionSwitcher compact current={conversationId} onPick={(id) => setConversationId(id)} onNew={() => setConversationId(null)} />
              </ChatBoundary>
              <button type="button" onClick={() => setConversationId(null)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-strong hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
                <Plus className="size-4" aria-hidden /> New
              </button>
            </div>
            <Link href="/app/chats" onClick={closePanel} className="self-start text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
              All chats
            </Link>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ChatBoundary compact>
              <ChatThread key={conversationId ?? "new"} compact conversationId={conversationId} onStarted={(id) => setConversationId(id)} />
            </ChatBoundary>
          </div>
        </aside>
      ) : null}
      {artifactId && !hidden ? (
        <div className={cn("fixed inset-0 z-50 flex sm:inset-y-0 sm:left-auto sm:border-l sm:border-border sm:shadow-2xl", panelOpen ? "sm:right-[27rem] sm:w-[min(34rem,calc(100vw-28rem))]" : "sm:right-0 sm:w-[min(36rem,100vw)]")}>
          <div className="flex min-h-0 w-full flex-col">
            <ChatBoundary compact>
              <DocumentWorkspace artifactId={artifactId} onClose={() => openArtifact(null)} />
            </ChatBoundary>
          </div>
        </div>
      ) : null}
    </>
  );
}
