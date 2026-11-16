"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useChat } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { useNow } from "@/components/app/use-now";
import { Check, ChevronDown, EllipsisVertical, FolderOpen, PenLine, Plus, Search, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { shortWhen, STATE_LOOK, type ConversationState } from "@/lib/app/chat/session";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

export type SessionRow = { conversationId: string; title: string; state: ConversationState; pinned: boolean; shelf: "active" | "archived" | "deleted"; updatedAt: number };

const TONE: Record<(typeof STATE_LOOK)[ConversationState]["tone"], string> = {
  brand: "border-brand-500/30 bg-brand-500/10 text-brand-300",
  warning: "border-warning/50 bg-warning/10 text-warning-foreground",
  success: "border-success/40 bg-success/10 text-success-foreground",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive-foreground",
  muted: "border-border bg-muted text-muted-foreground",
};

export function StateBadge({ state, className }: { state: ConversationState; className?: string }) {
  const look = STATE_LOOK[state];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap", TONE[look.tone], className)}>
      {state === "working" ? <span className="live-pulse size-1.5 rounded-full bg-brand-400" aria-hidden /> : null}
      {look.label}
    </span>
  );
}

export const chatHref = (conversationId: string) => `/app/chat/${conversationId}`;

/** A chat in a list: its title, its status in words, and when it last changed. */
export function SessionLink({ row, active, onNavigate, dense }: { row: SessionRow; active?: boolean; onNavigate?: () => void; dense?: boolean }) {
  const now = useNow();
  return (
    <Link
      href={chatHref(row.conversationId)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn("group flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-500", dense ? "min-h-8 px-2 py-1 text-[13px]" : "border border-border bg-card px-3.5 py-3 text-sm hover:border-brand-500/40", active ? "bg-brand-950 text-brand-300" : dense ? "text-muted-foreground hover:bg-muted hover:text-strong" : "text-strong")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.title}</span>
        {dense ? null : <span className="mt-0.5 block text-xs text-muted-foreground">{now ? shortWhen(row.updatedAt, now) : ""}</span>}
      </span>
      {row.state !== "completed" && row.state !== "idle" ? <StateBadge state={row.state} /> : null}
    </Link>
  );
}

/** Rename, pin, archive and delete for one chat. Deleting asks first, and a working chat must be stopped first. */
export function SessionActions({ row, onDeleted }: { row: SessionRow; onDeleted?: () => void }) {
  const { companyId } = useCompany();
  const rename = useMutation(api.chat.rename);
  const pin = useMutation(api.chat.setPinned);
  const archive = useMutation(api.chat.setArchived);
  const remove = useMutation(api.chat.remove);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [title, setTitle] = useState(row.title);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const menu = useId();
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await work();
      after?.();
      setOpen(false);
      setMode("menu");
    } catch (caught) {
      setError(messageOf(caught));
    }
  };
  return (
    <div
      ref={shell}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button type="button" onClick={() => setOpen((before) => !before)} aria-haspopup="menu" aria-expanded={open} aria-controls={menu} aria-label="Chat options" className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
        <EllipsisVertical className="size-4" aria-hidden />
      </button>
      {notice ? (
        <p role="status" className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-card p-2 text-xs text-muted-foreground shadow-lg">
          {notice}
        </p>
      ) : null}
      {open ? (
        <div id={menu} className="live-enter absolute top-full right-0 z-30 mt-1 w-64 rounded-xl border border-border bg-card p-1.5 shadow-xl">
          {mode === "rename" ? (
            <form
              className="grid gap-2 p-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => rename({ companyId, conversationId: row.conversationId, title }));
              }}
            >
              <label className="grid gap-1 text-xs font-medium text-strong">
                Title
                <input autoFocus value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm font-normal text-strong outline-none focus:border-brand-500/60" />
              </label>
              <div className="flex gap-1.5">
                <Button size="sm" type="submit" variant="default">
                  Save
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setMode("menu")}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : mode === "delete" ? (
            <div className="grid gap-2 p-1.5 text-sm">
              <p className="font-medium text-strong">Delete this chat?</p>
              <p className="text-xs leading-relaxed text-muted-foreground">Its messages are removed for good. Records it created, drafts it saved and the receipts of what it did stay.</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="destructive" onClick={() => void run(() => remove({ companyId, conversationId: row.conversationId }), onDeleted)}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("menu")}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <ul role="menu" aria-label="Chat options" className="grid gap-0.5">
              <li role="none">
                <button type="button" role="menuitem" autoFocus onClick={() => setMode("rename")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted">
                  <PenLine className="size-4 text-muted-foreground" aria-hidden /> Rename
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => void run(() => pin({ companyId, conversationId: row.conversationId, pinned: !row.pinned }))} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted">
                  <Check className="size-4 text-muted-foreground" aria-hidden /> {row.pinned ? "Unpin" : "Pin"}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void run(async () => {
                      const answer = await archive({ companyId, conversationId: row.conversationId, archived: row.shelf !== "archived" });
                      if (answer.stillWorking) setNotice("Archived. Its response is still being written; archiving does not stop it. Use Stop in the chat to end it.");
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted"
                >
                  <FolderOpen className="size-4 text-muted-foreground" aria-hidden /> {row.shelf === "archived" ? "Move back to chats" : "Archive"}
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => setMode("delete")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive-foreground hover:bg-destructive/10">
                  <Trash2 className="size-4" aria-hidden /> Delete
                </button>
              </li>
            </ul>
          )}
          {error ? (
            <p role="alert" className="m-1.5 rounded-lg bg-destructive/5 px-2 py-1.5 text-xs text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The session dropdown in a chat's header: new chat, pinned, recent, and the way to all chats. */
export function SessionSwitcher({ current, onPick, onNew, compact, label }: { current: string | null; onPick: (conversationId: string) => void; onNew: () => void; compact?: boolean; label?: string }) {
  const { companyId } = useCompany();
  const lists = useQuery(api.chat.recent, { companyId, limit: 8 });
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const menu = useId();
  const all = [...(lists?.pinned ?? []), ...(lists?.recent ?? [])] as SessionRow[];
  const title = label ?? (current ? (all.find((row) => row.conversationId === current)?.title ?? "This chat") : "New chat");
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!shell.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (conversationId: string) => {
    setOpen(false);
    onPick(conversationId);
  };
  const section = (label: string, rows: SessionRow[]) =>
    rows.length ? (
      <li role="none">
        <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</p>
        <ul className="grid gap-0.5">
          {rows.map((row) => (
            <li key={row.conversationId} role="none">
              <button type="button" role="menuitemradio" aria-checked={row.conversationId === current} onClick={() => pick(row.conversationId)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted">
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
                {row.state !== "completed" && row.state !== "idle" ? <StateBadge state={row.state} /> : null}
                {row.conversationId === current ? <Check className="size-3.5 text-brand-300" aria-label="Open now" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </li>
    ) : null;
  return (
    <div
      ref={shell}
      className={cn("relative min-w-0", compact ? "flex-1" : "w-full max-w-sm")}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button type="button" onClick={() => setOpen((before) => !before)} aria-haspopup="menu" aria-expanded={open} aria-controls={menu} className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm text-strong hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <ul id={menu} role="menu" aria-label="Chats" className="live-enter absolute top-full left-0 z-40 mt-1 grid max-h-[24rem] w-full min-w-[16rem] overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand-300 hover:bg-muted"
            >
              <Plus className="size-4" aria-hidden /> New chat
            </button>
          </li>
          {lists === undefined ? <li className="px-2.5 py-2 text-xs text-muted-foreground">Loading…</li> : null}
          {section("Pinned", (lists?.pinned ?? []) as SessionRow[])}
          {section("Recent", (lists?.recent ?? []) as SessionRow[])}
          <li role="none" className="mt-1 border-t border-border pt-1">
            <Link href="/app/chats" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-strong hover:bg-muted">
              <Search className="size-4 text-muted-foreground" aria-hidden /> Search all chats
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Every chat the person started, searchable, in pages. The dropdowns show a handful; this is where the
 * rest are, so no chat is ever out of reach.
 */
export function ChatHistory() {
  const { companyId } = useCompany();
  const router = useRouter();
  const { setConversationId } = useChat();
  const [shelf, setShelf] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const listed = usePaginatedQuery(api.chat.sessions, term ? "skip" : { companyId, shelf }, { initialNumItems: 20 });
  const found = usePaginatedQuery(api.chat.search, term ? { companyId, shelf, query: term } : "skip", { initialNumItems: 20 });
  const source = term ? found : listed;
  const rows = source.results as SessionRow[];
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl tracking-tight text-strong">All chats</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every chat you started in this company. Only you can see them.</p>
        </div>
        <Button variant="gradient" onClick={() => router.push("/app/chat")}>
          <Plus className="size-4" aria-hidden /> New chat
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:border-brand-500/50">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search chats</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title or what you asked" className="h-10 w-full bg-transparent text-sm text-strong outline-none placeholder:text-muted-foreground" />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-strong">
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </label>
        <div role="tablist" aria-label="Which chats" className="flex rounded-xl border border-border bg-muted p-0.5">
          {(["active", "archived"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={shelf === value} onClick={() => setShelf(value)} className={cn("h-9 rounded-[10px] px-3 text-xs font-semibold", shelf === value ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}>
              {value === "active" ? "Chats" : "Archived"}
            </button>
          ))}
        </div>
      </div>
      {source.status === "LoadingFirstPage" ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {source.status !== "LoadingFirstPage" && rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">{term ? `No chat matches “${term}”.` : shelf === "archived" ? "No archived chats." : "No chats yet. Start one with New chat."}</p>
      ) : null}
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.conversationId} className="flex items-center gap-2">
            <div className="min-w-0 flex-1" onClick={() => setConversationId(row.conversationId)}>
              <SessionLink row={row} />
            </div>
            <SessionActions row={row} />
          </li>
        ))}
      </ul>
      {source.status === "CanLoadMore" ? (
        <Button variant="outline" onClick={() => source.loadMore(20)} className="justify-self-center">
          Show older chats
        </Button>
      ) : null}
      {source.status === "LoadingMore" ? <p className="text-center text-sm text-muted-foreground">Loading…</p> : null}
    </div>
  );
}

/** Under Chat in the sidebar: new chat, search, pinned and recent chats, and the way to all of them. */
export function SidebarChatList({ onNavigate }: { onNavigate?: () => void }) {
  const { companyId } = useCompany();
  const { conversationId } = useChat();
  const lists = useQuery(api.chat.recent, { companyId, limit: 6 });
  const item = "flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500";
  const label = "px-2 pt-2 pb-0.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/80 uppercase";
  return (
    <ul className="grid gap-0.5" aria-label="Chats">
      <li>
        <Link href="/app/chat" onClick={onNavigate} className={item}>
          <Plus className="size-3.5" aria-hidden /> New chat
        </Link>
      </li>
      <li>
        <Link href="/app/chats" onClick={onNavigate} className={item}>
          <Search className="size-3.5" aria-hidden /> Search chats
        </Link>
      </li>
      {lists === undefined ? <li className="px-2 py-1 text-[11px] text-muted-foreground">Loading…</li> : null}
      {lists?.pinned.length ? (
        <li>
          <p className={label}>Pinned</p>
          <ul className="grid gap-0.5">
            {(lists.pinned as SessionRow[]).map((row) => (
              <li key={row.conversationId}>
                <SessionLink dense row={row} active={row.conversationId === conversationId} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </li>
      ) : null}
      {lists?.recent.length ? (
        <li>
          <p className={label}>Recent</p>
          <ul className="grid gap-0.5">
            {(lists.recent as SessionRow[]).map((row) => (
              <li key={row.conversationId}>
                <SessionLink dense row={row} active={row.conversationId === conversationId} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </li>
      ) : null}
      {lists && !lists.pinned.length && !lists.recent.length ? <li className="px-2 py-1 text-[11px] text-muted-foreground">No chats yet.</li> : null}
      <li>
        <Link href="/app/chats" onClick={onNavigate} className={cn(item, "text-brand-300")}>
          All chats
        </Link>
      </li>
    </ul>
  );
}
