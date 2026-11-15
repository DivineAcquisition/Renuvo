"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Action, Card, Loading, Notice, Page, Problem, problemWords, Row } from "./shell";

const CLOSED: Record<string, { tone: "neutral" | "warn" | "bad"; title: string; body: string }> = {
  declined: { tone: "neutral", title: "You declined this job", body: "Thanks for letting us know. Nothing else to do." },
  expired: { tone: "warn", title: "This offer has expired", body: "The time to answer has passed, so it has gone to someone else or back to the office." },
  filled: { tone: "neutral", title: "This job has been filled", body: "Another cleaner accepted it first. Nothing for you to do." },
  withdrawn: { tone: "neutral", title: "This offer was withdrawn", body: "The office took this offer back. Contact them if you have questions." },
  job_cancelled: { tone: "neutral", title: "This job was cancelled", body: "The visit is no longer happening." },
};

function timeLeft(respondBy: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((respondBy - now) / 60_000));
  if (minutes >= 120) return `about ${Math.round(minutes / 60)} hours left`;
  return minutes === 1 ? "1 minute left" : `${minutes} minutes left`;
}

/**
 * The offer. Loading this page only reads: accepting and declining are buttons, each its own request, so
 * a phone that previews the link cannot answer for the cleaner.
 */
export function OfferPage({ token }: { token: string }) {
  const data = useQuery(api.links.offer, { token });
  const accept = useMutation(api.links.acceptOffer);
  const decline = useMutation(api.links.declineOffer);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (data === undefined) return <Loading what="your job offer" />;

  const act = async (kind: "accept" | "decline") => {
    setBusy(kind);
    setProblem(null);
    try {
      const result = kind === "accept" ? await accept({ token }) : await decline({ token });
      // The page shows the new state by itself. A refusal that left the offer open is said here.
      if (result.message) setProblem(result.message);
    } catch (error) {
      setProblem(problemWords(error));
    } finally {
      setBusy(null);
    }
  };

  if (data.state === "accepted") {
    return (
      <Page company={data.company} title="You're confirmed">
        <Notice tone="good" title={`Thanks, ${data.cleanerFirstName}. This job is yours.`} testId="state-accepted">
          The address, instructions, checklist and check-in are on your job page. We also texted you the link.
        </Notice>
        {data.jobToken ? (
          <Link href={`/c/job/${data.jobToken}`} data-testid="open-job" className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-500 px-4 text-base font-semibold text-white">
            Open your job
          </Link>
        ) : (
          <Notice tone="warn" title="Your job link is not available here">Use the link in the confirmation text, or ask the office to send it again.</Notice>
        )}
      </Page>
    );
  }

  const offer = data.offer;
  if (data.state !== "open" || !offer) {
    const closed = CLOSED[data.state] ?? CLOSED.withdrawn;
    return (
      <Page company={data.company} title="Job offer">
        <Notice tone={closed.tone} title={closed.title} testId={`state-${data.state}`}>
          {closed.body}
        </Notice>
      </Page>
    );
  }

  return (
    <Page company={data.company} title={offer.backup ? "Cover needed" : "Job offer"}>
      <p className="text-sm text-muted-foreground">
        Hi {data.cleanerFirstName}. {offer.backup ? "A job needs cover. Can you take it?" : "Here is a job for you. Accept or decline below."}
      </p>
      <Card>
        <Row label="When">{offer.when}</Row>
        <Row label="How long">{offer.duration}</Row>
        {offer.mustFinishBy ? <Row label="Must finish by">{offer.mustFinishBy}</Row> : null}
        <Row label="Area">{offer.area}</Row>
        <Row label="Your role">{offer.role}</Row>
        <Row label="Estimated pay">
          <span data-testid="pay">{offer.estimatedPay}</span>
        </Row>
      </Card>
      <Card title={`${offer.serviceType} · what's included`}>
        <p className="text-sm whitespace-pre-line">{offer.scope}</p>
        {offer.requiredSkills.length > 0 ? <p className="text-sm text-muted-foreground">Needs: {offer.requiredSkills.join(", ")}</p> : null}
        <p className="text-xs text-muted-foreground">The street address and how to get in are shown after you accept.</p>
      </Card>
      <Notice tone="warn" title={`Answer by ${offer.respondByWords}`} testId="deadline">
        {now === null ? null : timeLeft(offer.respondBy, now)}
      </Notice>
      <Problem message={problem} />
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          {confirmDecline ? (
            <>
              <p className="text-sm font-medium">Decline this job?</p>
              <div className="flex gap-2">
                <Action kind="secondary" onPress={() => setConfirmDecline(false)} disabled={busy !== null}>
                  Keep it open
                </Action>
                <Action kind="danger" busy={busy === "decline"} disabled={busy !== null} onPress={() => void act("decline")} testId="confirm-decline">
                  Yes, decline
                </Action>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Action kind="secondary" disabled={busy !== null} onPress={() => setConfirmDecline(true)} testId="decline">
                Decline
              </Action>
              <Action busy={busy === "accept"} disabled={busy !== null} onPress={() => void act("accept")} testId="accept">
                Accept job
              </Action>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
