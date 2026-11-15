"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Modal } from "@/components/app/modal";
import { ScheduleTable, type ScheduleView, ViewSwitch } from "@/components/app/overview/schedule-table";
import { NewVisitForm } from "@/components/app/screens/forms";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

export function ScheduleBoard({ initial = "today" }: { initial?: ScheduleView }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const [view, setView] = useState<ScheduleView>(initial);
  const [adding, setAdding] = useState(false);
  const schedule = useQuery(api.overview.schedule, now ? { companyId, asOf: now, view } : "skip");
  return (
    <>
      <Panel
        title="Visits"
        flush
        action={
          <div className="flex items-center gap-2">
            <ViewSwitch view={view} onChange={setView} />
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add a visit
            </Button>
          </div>
        }
      >
        {schedule ? (
          <ScheduleTable visits={schedule.visits} dayStarts={schedule.dayStarts} now={now} timezone={timezone} onOpen={open} emptyHint="Add a visit to see it here. It stays uncovered until a cleaner accepts." />
        ) : (
          <div className="grid gap-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </Panel>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a visit" description="A visit is a promise to the customer. It is covered only when a cleaner accepts it.">
        <NewVisitForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}

export function ScheduleScreen() {
  return (
    <>
      <PageHeader title="Schedule" lead="Every visit, who is on it, and whether they accepted. Tomorrow is one switch away, so a gap can be fixed before the morning." />
      <ScheduleBoard />
    </>
  );
}
