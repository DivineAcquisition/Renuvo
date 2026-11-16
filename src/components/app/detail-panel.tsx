"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Component, createContext, Suspense, useCallback, useContext, useState } from "react";

import { useOfferChatContext } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { DetailActions } from "@/components/app/detail-actions";
import { AgreementsForRecord } from "@/components/app/agreements/record";
import { DetailView } from "@/components/app/detail-view";
import { useNow } from "@/components/app/use-now";
import { Check, LinkIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../convex/_generated/api";
import type { EventRef } from "../../../convex/lib/eventWords";

type Open = (ref: EventRef) => void;
const DetailContext = createContext<Open>(() => undefined);

/** Opens the shared detail panel for a visit, an approval or a task, from anywhere in the app. */
export function useDetail(): Open {
  return useContext(DetailContext);
}

/**
 * The panel's target lives in the address, as `?open=job:<id>`. So the same visit opens the same way
 * from every screen, the address can be copied to come back to it, and the browser's Back closes it.
 */
export const DETAIL_PARAM = "open";
const KINDS = ["job", "approval", "task"] as const;

export function detailParam(ref: EventRef): string {
  return `${ref.kind}:${ref.id}`;
}

function refFrom(value: string | null): EventRef | null {
  if (!value) return null;
  const at = value.indexOf(":");
  const [kind, id] = [value.slice(0, at), value.slice(at + 1)];
  if (!KINDS.includes(kind as (typeof KINDS)[number]) || !/^[a-z0-9]{8,64}$/i.test(id)) return null;
  return { kind, id } as EventRef;
}

function setTarget(ref: EventRef | null) {
  const url = new URL(window.location.href);
  const had = url.searchParams.has(DETAIL_PARAM);
  if (ref) url.searchParams.set(DETAIL_PARAM, detailParam(ref));
  else url.searchParams.delete(DETAIL_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}`;
  // Opening adds one step to go back from. Moving between records, and closing, do not pile more on.
  if (ref && !had) window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

/** A link that does not open is told plainly. It never takes the page down with it. */
class Guard extends Component<{ children: React.ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid gap-3 p-6">
        <p className="text-base font-semibold text-strong">This record cannot be opened</p>
        <p className="text-sm leading-relaxed text-muted-foreground">It may have been removed, the link may be incomplete, or it may belong to a company you are not signed in to.</p>
        <div>
          <Button variant="outline" size="sm" onClick={this.props.onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <LinkIcon className="size-3.5" aria-hidden />}
      {copied ? "Link copied" : "Copy a link to this"}
    </button>
  );
}

function Body({ target, onOpen }: { target: EventRef; onOpen: Open }) {
  const company = useCompany();
  // The record open here is offered to Ask Selestial as context the person can remove.
  useOfferChatContext(target.kind === "job" ? [{ table: "jobs", id: target.id }] : target.kind === "task" ? [{ table: "tasks", id: target.id }] : null);
  const now = useNow();
  const detail = useQuery(api.details.get, now ? { companyId: company.companyId, ref: target, asOf: now } : "skip");
  if (detail === undefined) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <>
      <DetailView detail={detail} now={now} timezone={company.timezone} onOpen={onOpen} actions={<DetailActions detail={detail} now={now} timezone={company.timezone} />} />
      {target.kind === "job" ? (
        <div className="border-t border-border px-5 py-4 sm:px-6">
          <AgreementsForRecord table="jobs" id={target.id} />
        </div>
      ) : null}
      <div className="border-t border-border px-5 py-3 sm:px-6">
        <CopyLink />
      </div>
    </>
  );
}

function Panel({ onOpen }: { onOpen: Open }) {
  const target = refFrom(useSearchParams().get(DETAIL_PARAM));
  const close = () => setTarget(null);
  return (
    <Sheet open={target !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetPopup side="right" className="max-w-xl bg-card">
        <SheetTitle className="sr-only">Details</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">
          {target ? (
            <Guard key={detailParam(target)} onClose={close}>
              <Body target={target} onOpen={onOpen} />
            </Guard>
          ) : null}
        </ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

export function DetailProvider({ children }: { children: React.ReactNode }) {
  const open = useCallback<Open>((ref) => setTarget(ref), []);
  return (
    <DetailContext.Provider value={open}>
      {children}
      {/* The address is read on the client only, so the panel is the one part that waits for it. */}
      <Suspense fallback={null}>
        <Panel onOpen={open} />
      </Suspense>
    </DetailContext.Provider>
  );
}
