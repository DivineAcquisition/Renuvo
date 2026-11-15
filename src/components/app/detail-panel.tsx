"use client";

import { useQuery } from "convex/react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { DetailActions } from "@/components/app/detail-actions";
import { DetailView } from "@/components/app/detail-view";
import { useNow } from "@/components/app/use-now";
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

function Body({ target, onOpen }: { target: EventRef; onOpen: Open }) {
  const company = useCompany();
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
  return <DetailView detail={detail} now={now} timezone={company.timezone} onOpen={onOpen} actions={<DetailActions detail={detail} now={now} timezone={company.timezone} />} />;
}

export function DetailProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<EventRef | null>(null);
  const open = useCallback<Open>((ref) => setTarget(ref), []);
  const value = useMemo(() => open, [open]);
  return (
    <DetailContext.Provider value={value}>
      {children}
      <Sheet open={target !== null} onOpenChange={(next) => (next ? undefined : setTarget(null))}>
        <SheetPopup side="right" className="max-w-xl bg-background">
          <SheetTitle className="sr-only">Details</SheetTitle>
          <ScrollArea className="min-h-0 flex-1">{target ? <Body key={`${target.kind}:${target.id}`} target={target} onOpen={open} /> : null}</ScrollArea>
        </SheetPopup>
      </Sheet>
    </DetailContext.Provider>
  );
}
