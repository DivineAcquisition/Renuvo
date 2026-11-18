"use client";

/**
 * A look at one client from the directory without leaving it: the search, filters and scroll position
 * stay underneath. "Open the full profile" goes to the client's own page for deeper work.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowUpRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { clientPath, type TabId } from "@/lib/app/clients";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { OverviewTab } from "./overview";
import { ProfileHeader } from "./profile";
import { rememberScroll } from "./state";

function Body({ customerId }: { customerId: string }) {
  const { companyId } = useCompany();
  const profile = useQuery(api.clients.profile, { companyId, customerId: customerId as Id<"customers"> });
  if (profile === undefined) {
    return (
      <div className="grid gap-4 p-5 sm:p-6" aria-busy="true" aria-label="Loading the client">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="grid gap-4 p-5 sm:p-6">
      <div className="pr-8">
        <ProfileHeader profile={profile} onDialog={() => undefined} compact />
      </div>
      <Button variant="outline" size="sm" className="w-fit" render={<Link href={clientPath(customerId)} onClick={rememberScroll} />}>
        Open the full profile
        <ArrowUpRight aria-hidden />
      </Button>
      <OverviewTab profile={profile} onBook={() => undefined} compact />
    </div>
  );
}

export function ClientQuickView({ customerId, onClose }: { customerId: string | null; tab?: TabId; onClose: () => void; onTab?: (tab: TabId) => void }) {
  return (
    <Sheet open={customerId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="w-full max-w-2xl bg-background">
        <SheetTitle className="sr-only">Client quick view</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{customerId ? <Body key={customerId} customerId={customerId} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
