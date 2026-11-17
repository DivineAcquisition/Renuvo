"use client";

/**
 * A focused look at one person from the directory, without leaving it. The search, filters and view stay
 * as they were underneath; closing returns to them. "Open full profile" goes to the person's own page.
 */
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight } from "@/components/icons";

import { PendingRequests, ProfileActions, ProfileHeader, SectionBody, SectionTabs, useProfile } from "./profile";
import { isSection, profilePath, type SectionId } from "./state";

function Body({ cleanerId, section, onSection }: { cleanerId: string; section: SectionId; onSection: (section: string | undefined) => void }) {
  const profile = useProfile(cleanerId);
  if (profile === undefined) {
    return (
      <div className="grid gap-4 p-5 sm:p-6" aria-busy="true">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="grid gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
        <ProfileHeader profile={profile} compact />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" render={<Link href={profilePath(cleanerId, section)} />}>
          Open full profile
          <ArrowUpRight aria-hidden />
        </Button>
      </div>
      <ProfileActions profile={profile} />
      <PendingRequests cleanerId={profile.cleanerId} />
      <SectionTabs cleanerId={cleanerId} active={section} onSection={(next) => onSection(next === "overview" ? undefined : next)} />
      <SectionBody section={section} profile={profile} onSection={(next) => onSection(next === "overview" ? undefined : next)} />
    </div>
  );
}

export function CleanerDrawer({ cleanerId, section, onClose, onSection }: { cleanerId: string | null; section?: string; onClose: () => void; onSection: (section: string | undefined) => void }) {
  const current: SectionId = isSection(section) ? section : "overview";
  return (
    <Sheet open={cleanerId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="w-full max-w-2xl bg-background">
        <SheetTitle className="sr-only">Cleaner profile</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{cleanerId ? <Body key={cleanerId} cleanerId={cleanerId} section={current} onSection={onSection} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
