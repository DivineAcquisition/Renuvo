"use client";

/**
 * Step 6: where things stand, as six milestones read from what actually happened. For each: its status,
 * when it last changed, what happens next, and whether the owner needs to do anything. No promised dates
 * and no countdowns. When the carriers ask for a change, everything already filled in is kept.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { FormError, messageOf, TextInput } from "@/components/app/form";
import { CheckCircle2, CircleDashed, Hourglass, Loader, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { formatPhone, useSetup } from "./context";
import { Note, StepHeading, type Milestone } from "./parts";

const STATE: Record<Milestone["state"], { icon: typeof CheckCircle2; label: string; className: string }> = {
  done: { icon: CheckCircle2, label: "Done", className: "text-success-foreground" },
  working: { icon: Loader, label: "In progress", className: "text-info-foreground" },
  waiting: { icon: Hourglass, label: "Not started", className: "text-muted-foreground" },
  needs_you: { icon: TriangleAlert, label: "Needs you", className: "text-warning-foreground" },
  problem: { icon: TriangleAlert, label: "Stopped", className: "text-destructive-foreground" },
};

const when = (at: number | null) => (at ? new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);

export function ProgressStep() {
  const { view, go } = useSetup();
  const request = view.request;
  if (!request) {
    return (
      <>
        <StepHeading eyebrow="Step 6 of 6" title="Getting you ready" lead="Nothing has been submitted yet." />
        <div>
          <Button variant="primary" onClick={() => void go("review")}>
            Review and submit
          </Button>
        </div>
      </>
    );
  }
  const ready = request.status === "active";
  return (
    <>
      <StepHeading
        eyebrow="Step 6 of 6"
        title={ready ? "Your business can text" : "Getting you ready"}
        lead={ready ? `Texts go out from ${formatPhone(request.phoneNumber)}. Your agents can send the kinds of texts you registered, to people who agreed.` : "Here's where things stand. Selestial tells you whenever something needs you."}
      />
      {request.needs ? <Needs /> : null}
      {request.status === "rejected" ? (
        <Note tone="warning">
          Selestial review didn&apos;t approve this request. Nothing was filed or charged. You can change your details and{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => void go("review")}>
            submit again
          </button>
          .
        </Note>
      ) : null}
      <ol className="grid gap-0" aria-label="Milestones">
        {request.milestones.map((row, at) => {
          const state = STATE[row.state];
          const Icon = state.icon;
          return (
            <li key={row.key} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
              {at < request.milestones.length - 1 ? <span aria-hidden className={cn("absolute top-7 bottom-0 left-[0.95rem] w-px", row.state === "done" ? "bg-success/50" : "bg-border")} /> : null}
              <span className={cn("grid size-8 place-items-center rounded-full border bg-card", row.state === "done" ? "border-success/50" : "border-border")} aria-hidden>
                {row.state === "waiting" ? <CircleDashed className="size-4 text-muted-foreground" /> : <Icon className={cn("size-4", state.className)} />}
              </span>
              <div className="grid gap-0.5 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-strong">{row.label}</p>
                  <Badge variant={row.state === "done" ? "success" : row.state === "needs_you" ? "warning" : row.state === "problem" ? "error" : row.state === "working" ? "info" : "outline"}>{state.label}</Badge>
                  {row.ownerAction ? <span className="text-xs font-medium text-warning-foreground">Your action needed</span> : null}
                </div>
                <p className="text-sm text-muted-foreground">{row.next}</p>
                {when(row.at) ? <p className="text-xs text-muted-foreground">Last update {when(row.at)}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {ready || request.status === "interrupted" ? <AgentTexts /> : null}
      <Withdraw />
    </>
  );
}

const AGENT_NAMES = { sales: "Sales", dispatch: "Dispatch", recruiter: "Recruiter", retention: "Retention" } as const;

/** After activation: which activities each agent can text, so nothing is assumed from one switch. */
function AgentTexts() {
  const { companyId } = useSetup();
  const rows = useQuery(api.texting.agentTexting, { companyId });
  if (!rows) return null;
  return (
    <section className="grid gap-3 border-t border-border pt-5" aria-label="What your agents can send">
      <h3 className="text-sm font-semibold text-strong">What your agents can send</h3>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.agent} className="grid gap-1.5 rounded-xl border border-border px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-strong">{AGENT_NAMES[row.agent]}</span>
              <Badge variant={row.state === "ready" ? "success" : row.state === "partly" ? "info" : row.state === "paused" ? "error" : "warning"}>{row.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{row.words}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label={`${AGENT_NAMES[row.agent]} activities`}>
              {row.activities.map((activity) => (
                <li key={activity.key}>
                  <Badge variant={activity.ready ? "outline" : "warning"}>
                    {activity.ready ? <CheckCircle2 aria-hidden /> : <CircleDashed aria-hidden />}
                    {activity.label}
                    <span className="sr-only">{activity.ready ? " (ready)" : " (not included)"}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Needs() {
  const { view, go, companyId } = useSetup();
  const request = view.request!;
  const needs = request.needs!;
  const confirm = useMutation(api.texting.confirmCode);
  const resend = useMutation(api.texting.resendCode);
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (needs.kind === "code") {
    return (
      <div className="grid gap-3 rounded-xl border border-warning/50 bg-warning/5 p-4">
        <p className="text-sm font-semibold text-strong">Confirm it&apos;s you</p>
        <p className="text-sm text-strong">{needs.words}</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setState("sending");
            confirm({ companyId, requestId: request.requestId, code }).then(
              () => setState("sent"),
              (caught) => {
                setState("idle");
                setError(messageOf(caught));
              },
            );
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-strong">Code</span>
            <TextInput value={code} onChange={(event) => setCode(event.target.value.slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" className="w-40" />
          </label>
          <Button type="submit" variant="primary" disabled={code.trim().length < 4} loading={state === "sending"}>
            Confirm
          </Button>
          <Button type="button" variant="ghost" onClick={() => void resend({ companyId, requestId: request.requestId }).catch((caught) => setError(messageOf(caught)))}>
            Send a new code
          </Button>
        </form>
        {state === "sent" ? <p className="text-xs text-muted-foreground">Checking your code with the carriers…</p> : null}
        <FormError message={error} />
      </div>
    );
  }
  // Carriers name business fields when the business itself needs correcting; otherwise it's how the company texts.
  const target = needs.kind === "number" ? "number" : needs.fields.length ? "business" : "permission";
  return (
    <div className="grid gap-3 rounded-xl border border-warning/50 bg-warning/5 p-4">
      <p className="text-sm font-semibold text-strong">{needs.kind === "number" ? "Choose another number" : "A correction is needed"}</p>
      <p className="text-sm text-strong">{needs.words}</p>
      {needs.kind === "correction" ? <p className="text-xs text-muted-foreground">Everything you filled in is kept. Change what&apos;s needed, then send it back from Review. Filing a corrected registration with the carriers is charged once each time ({view.charges.rows.find((row) => row.key === "resubmission")?.amount}).</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void go(target)}>
          {needs.kind === "number" ? "Choose a number" : "Make the change"}
        </Button>
        {needs.kind === "correction" ? (
          <Button variant="outline" onClick={() => void go("review")}>
            Go to Review
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Withdraw() {
  const { view, companyId } = useSetup();
  const withdraw = useMutation(api.textingSetup.withdraw);
  const [error, setError] = useState<string | null>(null);
  const request = view.request!;
  if (request.status !== "requested") return null;
  return (
    <div className="grid gap-2 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">Need to change something before Selestial reviews it? Withdraw the request; your answers stay saved.</p>
      <div>
        <Button variant="outline" size="sm" onClick={() => void withdraw({ companyId }).catch((caught) => setError(messageOf(caught)))}>
          Withdraw to make changes
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
