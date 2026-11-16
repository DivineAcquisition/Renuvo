"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Action, Card, Loading, Notice, Page, Problem, problemWords, Row } from "@/components/cleaner/shell";

const CLOSED = {
  declined: { title: "You declined this offer", body: "Thank you for letting us know." },
  expired: { title: "This offer is no longer open", body: "Reply to the email that brought you here if you have questions." },
  closed: { title: "There is no open offer here", body: "Reply to the email that brought you here if you have questions." },
} as const;

/** The offer. Loading the page accepts nothing: accepting and declining are buttons, each behind a confirmation. */
export function HiringOfferPage({ token }: { token: string }) {
  const data = useQuery(api.applicantPages.hiringOffer, { token });
  const accept = useMutation(api.applicantPages.acceptOffer);
  const decline = useMutation(api.applicantPages.declineOffer);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [confirm, setConfirm] = useState<"accept" | "decline" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (data === undefined) return <Loading what="your offer" />;
  const terms = data.terms;
  if (data.state === "declined" || data.state === "expired" || data.state === "closed") {
    return (
      <Page company={data.company} title="Offer">
        <Notice tone="neutral" title={CLOSED[data.state].title} testId={`state-${data.state}`}>{CLOSED[data.state].body}</Notice>
      </Page>
    );
  }
  const act = async (kind: "accept" | "decline") => {
    setBusy(kind);
    setProblem(null);
    try {
      await (kind === "accept" ? accept({ token }) : decline({ token }));
    } catch (error) {
      setProblem(problemWords(error));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <Page company={data.company} title={terms ? `Offer: ${terms.role}` : "Offer"}>
      {data.state === "accepted" ? (
        <Notice tone="good" title="You accepted this offer" testId="state-accepted">
          {data.company} will contact you about the next steps: the agreement, documents, training and setup. You are not scheduled for any work until those are complete.
        </Notice>
      ) : (
        <p className="text-sm text-muted-foreground">{data.firstName ? `Hi ${data.firstName}. ` : ""}Here is {data.company}&apos;s offer. Read it, then accept or decline below.</p>
      )}
      {terms ? (
        <Card title="The terms">
          <Row label="Role">{terms.role}</Row>
          <Row label="Type of work">{terms.workerType}</Row>
          <Row label="Pay"><span data-testid="pay">{terms.pay}</span></Row>
          {terms.startConditions ? <Row label="Start">{terms.startConditions}</Row> : null}
          {terms.expectations ? <Row label="Expectations">{terms.expectations}</Row> : null}
          <p className="text-xs text-muted-foreground">This offer is not the agreement and does not promise a particular amount of work. The agreement and onboarding come next.</p>
        </Card>
      ) : null}
      <Problem message={problem} />
      {data.state === "open" ? (
        confirm ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-border p-4">
            <p className="text-sm font-medium">{confirm === "accept" ? "Accept this offer?" : "Decline this offer?"}</p>
            <div className="flex gap-2">
              <Action kind="secondary" disabled={busy !== null} onPress={() => setConfirm(null)}>Go back</Action>
              <Action kind={confirm === "accept" ? "primary" : "danger"} busy={busy === confirm} disabled={busy !== null} onPress={() => void act(confirm)} testId={`confirm-${confirm}`}>
                {confirm === "accept" ? "Yes, accept" : "Yes, decline"}
              </Action>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Action kind="secondary" onPress={() => setConfirm("decline")} testId="decline">Decline</Action>
            <Action onPress={() => setConfirm("accept")} testId="accept">Accept offer</Action>
          </div>
        )
      ) : null}
    </Page>
  );
}
