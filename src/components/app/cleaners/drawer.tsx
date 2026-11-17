"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, useState } from "react";

import { ProfileHeader, ProfileModals, ReadinessChecklist } from "@/components/app/cleaners/profile";
import { Chips, NextLine } from "@/components/app/cleaners/shared";
import { useCompany } from "@/components/app/company";
import { useNow } from "@/components/app/use-now";
import { ArrowRight, MapPin, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cleanerPath, PROFILE_SECTIONS } from "@/lib/app/cleaners";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

class Guard extends Component<{ children: React.ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid gap-3 p-6">
        <p className="text-base font-semibold text-strong">This person cannot be opened</p>
        <p className="text-sm leading-relaxed text-muted-foreground">They may have been removed, the link may be incomplete, or they may belong to a company you are not signed in to.</p>
        <div>
          <Button variant="outline" size="sm" onClick={this.props.onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }
}

type Open = Parameters<typeof ProfileModals>[0]["open"];

function Body({ cleanerId }: { cleanerId: Id<"cleaners"> }) {
  const company = useCompany();
  const now = useNow();
  const profile = useQuery(api.workforce.profile, now ? { companyId: company.companyId, cleanerId, asOf: now } : "skip");
  const [open, setOpen] = useState<Open>(null);
  if (profile === undefined) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const unmet = profile.readiness.checks.filter((check) => check.state === "unmet");
  return (
    <div className="grid gap-5 p-5 sm:p-6">
      <ProfileHeader profile={profile} onEdit={setOpen} compact />
      {profile.attentionItems.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Needs attention</h3>
          {profile.attentionItems.map((item) => (
            <div key={item.key} className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-strong">{item.title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{item.detail}</span>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Readiness{unmet.length === 0 ? " · every check met" : ""}</h3>
        <ReadinessChecklist checks={profile.readiness.checks} />
      </section>
      <section className="grid gap-3 rounded-2xl border border-border p-4">
        <NextLine row={profile} />
        <span className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Chips values={profile.serviceAreas} max={6} empty="No service area set" mono />
        </span>
        {profile.skills.length > 0 ? <Chips values={profile.skills} max={6} /> : null}
      </section>
      <section className="grid gap-2">
        <Button variant="primary" render={<Link href={cleanerPath(profile.cleanerId)} />}>
          Open full profile <ArrowRight aria-hidden />
        </Button>
        <div className="flex flex-wrap gap-1.5">
          {PROFILE_SECTIONS.filter((section) => section.id !== "overview").map((section) => (
            <Link key={section.id} href={cleanerPath(profile.cleanerId, section.id)} className="inline-flex min-h-8 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
              {section.label}
            </Link>
          ))}
        </div>
      </section>
      <ProfileModals profile={profile} open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** A focused view of one person over the list. The list, its search and its filters stay as they were. */
export function WorkerDrawer({ cleanerId, onClose }: { cleanerId: string | null; onClose: () => void }) {
  return (
    <Sheet open={cleanerId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-lg bg-card">
        <SheetTitle className="sr-only">Cleaner</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">
          {cleanerId ? (
            <Guard key={cleanerId} onClose={onClose}>
              <Body cleanerId={cleanerId as Id<"cleaners">} />
            </Guard>
          ) : null}
        </ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
