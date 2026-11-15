"use client";

import { useState } from "react";

import { DetailView } from "@/components/app/detail-view";
import { OverviewView } from "@/components/app/overview/overview-view";
import type { ScheduleView } from "@/components/app/overview/schedule-table";
import { AppShell } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { EXAMPLE_TIMEZONE, exampleDetail, exampleOverview } from "@/lib/app/example";

export function OverviewPreview({ panel }: { panel: boolean }) {
  const now = useNow();
  const [view, setView] = useState<ScheduleView>("today");
  const [open, setOpen] = useState(panel);
  if (!now) return null;
  const data = exampleOverview(now);
  return (
    <AppShell
      company="Sparkle Cleaning Co."
      decisionCount={data.decisions?.length}
      departments={data.team}
      banner={<p className="border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-center text-xs font-medium text-warning-foreground">Layout preview with made-up data. Nothing here is real, and nothing can be changed.</p>}
    >
      <OverviewView data={data} view={view} onView={setView} onOpen={() => setOpen(true)} onLink={(link) => (link.kind === "view" ? undefined : setOpen(true))} onApprove={() => undefined} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup side="right" className="max-w-xl bg-background">
          <SheetTitle className="sr-only">Details</SheetTitle>
          <ScrollArea className="min-h-0 flex-1">
            <DetailView detail={exampleDetail(now)} now={now} timezone={EXAMPLE_TIMEZONE} onOpen={() => undefined} />
          </ScrollArea>
        </SheetPopup>
      </Sheet>
    </AppShell>
  );
}
