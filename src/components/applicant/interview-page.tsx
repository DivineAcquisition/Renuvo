"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Action, Card, Loading, Notice, Page, Problem, problemWords } from "@/components/cleaner/shell";

/** Choosing an interview time. Loading the page reserves nothing; each time is its own button. */
export function InterviewPage({ token }: { token: string }) {
  const data = useQuery(api.applicantPages.interview, { token });
  const pick = useMutation(api.applicantPages.pickTime);
  const cancel = useMutation(api.applicantPages.cancelTime);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  if (data === undefined) return <Loading what="your interview" />;
  const title = `Interview: ${data.role}`;
  if (data.state === "expired" || data.state === "revoked" || data.state === "closed") {
    return (
      <Page company={data.company} title={title}>
        <Notice tone="neutral" title={data.state === "expired" ? "This link has expired" : "There is no interview to schedule here"} testId={`state-${data.state}`}>
          Reply to the email that brought you here if you have questions.
        </Notice>
      </Page>
    );
  }
  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setProblem(null);
    try {
      await action();
      setChanging(false);
    } catch (error) {
      setProblem(problemWords(error));
    } finally {
      setBusy(null);
    }
  };
  const choosing = data.state === "proposed" || changing;

  return (
    <Page company={data.company} title={title}>
      {data.state === "confirmed" && data.booked ? (
        <Notice tone="good" title={`You're booked: ${data.booked.when}`} testId="state-confirmed">
          Times are in {data.timezone}. {data.booked.how ?? "We also emailed you this time."}
        </Notice>
      ) : null}
      {data.state === "reserving" ? (
        <Notice tone="warn" title="Checking that time…" testId="state-reserving">
          We are confirming the time with the interviewer&apos;s calendar. This page will update. It is not confirmed yet.
        </Notice>
      ) : null}
      {choosing ? (
        <Card title={data.state === "confirmed" ? "Choose a different time" : `${data.firstName ? `Hi ${data.firstName}. ` : ""}Choose a time`}>
          <p className="text-xs text-muted-foreground">Times are in {data.timezone}.</p>
          {data.slots.length === 0 ? <p className="text-sm">There are no open times right now. Reply to the email that brought you here and we will arrange one.</p> : null}
          {data.slots.map((slot) => (
            <Action key={slot.slotId} kind="secondary" busy={busy === slot.slotId} disabled={busy !== null} onPress={() => void run(slot.slotId, () => pick({ token, slotId: slot.slotId as Id<"interviewSlots"> }))} testId={`slot-${slot.startsAt}`}>
              {slot.when}
            </Action>
          ))}
        </Card>
      ) : null}
      <Problem message={problem} />
      {data.state === "confirmed" && !changing ? (
        <div className="flex gap-2">
          <Action kind="secondary" disabled={busy !== null} onPress={() => setChanging(true)} testId="change">Change time</Action>
          <Action kind="danger" busy={busy === "cancel"} disabled={busy !== null} onPress={() => void run("cancel", () => cancel({ token }))} testId="cancel">Cancel</Action>
        </div>
      ) : null}
    </Page>
  );
}
