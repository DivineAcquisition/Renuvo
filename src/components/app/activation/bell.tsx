"use client";

/**
 * The in-app notification inbox in the header: this person's own notices, newest first, with unread
 * state kept on the server, so it is the same on every device. Each notice opens the record it is about;
 * the page it opens checks the person's role again.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { AgentAvatar, type AgentId } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { useNow } from "@/components/app/use-now";
import { AlertTriangle, Bell, CheckCircle2, Hand, Plug, Sparkles } from "@/components/icons";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { relative } from "./shared";

const KIND_ICON = { first_result: Sparkles, asset_created: CheckCircle2, task_completed: CheckCircle2, approval_required: Hand, needs_information: Hand, needs_connection: Plug, failed: AlertTriangle, batch_finished: Sparkles } as const;

export function NotificationBell() {
  const { companyId } = useCompany();
  const inbox = useQuery(api.notifications.inbox, { companyId, limit: 30 });
  const markRead = useMutation(api.notifications.markRead);
  const markAll = useMutation(api.notifications.markAllRead);
  const now = useNow() ?? 0;
  const [open, setOpen] = useState(false);
  const unread = inbox?.unread ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className={cn("relative inline-flex size-9 items-center justify-center rounded-lg border bg-card text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500", unread ? "border-brand-500/50" : "border-border")}
      >
        <Bell className="size-4" aria-hidden />
        {unread ? <span className="absolute -top-1 -right-1 grid min-w-4.5 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white tabular-nums">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
      <SheetPopup side="right" className="max-w-[26rem] bg-card p-0">
        <div className="flex items-center justify-between border-b border-border py-3 pr-12 pl-4">
          <SheetTitle className="text-sm font-semibold text-strong">Notifications</SheetTitle>
          {unread ? (
            <button type="button" onClick={() => void markAll({ companyId })} className="text-xs font-medium text-brand-600 underline-offset-4 hover:underline">
              Mark all read
            </button>
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {inbox === undefined ? (
            <li className="px-3.5 py-6 text-center text-sm text-muted-foreground">Loading…</li>
          ) : inbox.notices.length === 0 ? (
            <li className="px-3.5 py-6 text-center text-sm text-muted-foreground">Nothing yet. When your agents finish something or need you, it appears here.</li>
          ) : (
            inbox.notices.map((notice) => {
              const Icon = KIND_ICON[notice.kind];
              const body = (
                <>
                  {notice.agent ? <AgentAvatar agent={notice.agent as AgentId} size="xs" /> : <Icon className="mt-0.5 size-4 text-brand-600" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", notice.read ? "text-foreground" : "font-semibold text-strong")}>{notice.headline}</span>
                    <span className="line-clamp-2 block text-xs text-muted-foreground">{notice.summary}</span>
                    <span className="block text-[11px] text-muted-foreground/80">{relative(notice.at, now)}</span>
                  </span>
                  {notice.read ? null : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                </>
              );
              const done = () => {
                if (!notice.read) void markRead({ companyId, noticeId: notice.id });
                setOpen(false);
              };
              return (
                <li key={notice.id} className="border-b border-border/70 last:border-b-0">
                  {notice.href ? (
                    <Link href={notice.href} onClick={done} className="flex gap-2.5 px-3.5 py-3 hover:bg-muted/60">
                      {body}
                    </Link>
                  ) : (
                    <button type="button" onClick={done} className="flex w-full gap-2.5 px-3.5 py-3 text-left hover:bg-muted/60">
                      {body}
                    </button>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </SheetPopup>
      </Sheet>
    </>
  );
}
