"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRef, useState } from "react";

import { useNow } from "@/components/app/use-now";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Action, Card, linkKey, Loading, Notice, Page, Problem, problemWords, Row, TextBox, useDraft } from "./shell";

type Detail = NonNullable<FunctionReturnType<typeof api.links.job>["detail"]>;
type PhotoKind = "before" | "after" | "item";

const CLOSED: Record<string, { title: string; body: string }> = {
  ended: { title: "You are no longer on this job", body: "This link has been closed. If you think that is a mistake, contact the office." },
  expired: { title: "This link has run out", body: "The job's time has passed. Contact the office if you still need to add something." },
  job_cancelled: { title: "This job was cancelled", body: "The visit is no longer happening." },
  closed: { title: "This job is closed", body: "Nothing more is needed from you here." },
};

/** Runs one action, shows why if it is refused, and never runs two at once. */
function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const act = async (name: string, run: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false;
    setBusy(name);
    setProblem(null);
    try {
      await run();
      return true;
    } catch (error) {
      setProblem(problemWords(error));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, problem, act, setProblem };
}

/** The phone's position if the cleaner allows it within a few seconds. Check-in goes ahead either way. */
function position(): Promise<{ lat?: number; lng?: number; accuracyM?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({});
    const timer = window.setTimeout(() => resolve({}), 6000);
    navigator.geolocation.getCurrentPosition(
      (found) => {
        window.clearTimeout(timer);
        resolve({ lat: found.coords.latitude, lng: found.coords.longitude, accuracyM: found.coords.accuracy });
      },
      () => {
        window.clearTimeout(timer);
        resolve({});
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    );
  });
}

type Upload = { key: string; name: string; state: "uploading" | "failed"; file: File };

/**
 * Photo upload. Each photo gets a key from the file itself, so a retry after a dropped connection, or
 * choosing the same photo again after reopening the page, is recorded once. Photos already recorded come
 * from the server, which is what makes an unfinished upload resumable.
 */
function Photos({ token, kind, itemId, photos, required, locked, title }: { token: string; kind: PhotoKind; itemId?: Id<"checklistItems">; photos: Detail["photos"]["before"]; required?: number; locked: boolean; title: string }) {
  const uploadUrl = useMutation(api.links.photoUploadUrl);
  const attach = useMutation(api.links.attachPhoto);
  const remove = useMutation(api.links.removePhoto);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = async (entry: Upload) => {
    setUploads((list) => [...list.filter((row) => row.key !== entry.key), { ...entry, state: "uploading" }]);
    try {
      const url = await uploadUrl({ token });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": entry.file.type || "image/jpeg" }, body: entry.file });
      if (!response.ok) throw new Error("upload failed");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      await attach({ token, storageId, kind, clientKey: entry.key, itemId });
      setUploads((list) => list.filter((row) => row.key !== entry.key));
    } catch (error) {
      setProblem(problemWords(error));
      setUploads((list) => list.map((row) => (row.key === entry.key ? { ...row, state: "failed" } : row)));
    }
  };

  const choose = (files: FileList | null) => {
    setProblem(null);
    for (const file of Array.from(files ?? [])) {
      void send({ key: `${kind}:${itemId ?? ""}:${file.name}:${file.size}:${file.lastModified}`.slice(0, 80), name: file.name, state: "uploading", file });
    }
    if (input.current) input.current.value = "";
  };

  const short = required ? Math.max(0, required - photos.length) : 0;
  return (
    <Card title={title}>
      {required ? (
        <p className="text-sm text-muted-foreground" data-testid={`${kind}-count`}>
          {photos.length} added{short > 0 ? `, ${short} more needed` : ""}
        </p>
      ) : null}
      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((entry) => (
            <li key={entry.id} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
              {/* A stored upload at an address the app does not control, so the image optimizer is not used. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {entry.url ? <img src={entry.url} alt={`${kind} photo by ${entry.by}`} className="h-full w-full object-cover" /> : null}
              {entry.mine && !locked ? (
                <button type="button" onClick={() => void remove({ token, evidenceId: entry.id }).catch((error) => setProblem(problemWords(error)))} className="absolute top-1 right-1 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white" aria-label="Remove photo">
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {uploads.map((entry) => (
        <div key={entry.key} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{entry.name}</span>
          {entry.state === "uploading" ? (
            <span className="text-muted-foreground">Uploading…</span>
          ) : (
            <button type="button" className="font-semibold text-brand-600" onClick={() => void send(entry)}>
              Failed. Try again
            </button>
          )}
        </div>
      ))}
      <Problem message={problem} />
      {locked ? null : (
        <label className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-background px-4 text-base font-semibold active:bg-muted">
          Add photos
          <input ref={input} data-testid={`${kind}-input`} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => choose(event.target.files)} />
        </label>
      )}
    </Card>
  );
}

function Delay({ token, detail }: { token: string; detail: Detail }) {
  const reportDelay = useMutation(api.links.reportDelayJob);
  const cannot = useMutation(api.links.cannotAttendJob);
  const { busy, problem, act } = useAct();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [reason, setReason, clearReason] = useDraft(`delay.${linkKey(token)}`);
  const [cannotOpen, setCannotOpen] = useState(false);

  if (detail.checkedInAt !== null) return <Notice tone="good" title="You're checked in">There is nothing to report here.</Notice>;
  return (
    <>
      {sent ? (
        <Notice tone="good" title="Thanks, we've got it" testId="delay-sent">
          We told the office you expect to arrive {sent}. Check in on your job page when you get there.
        </Notice>
      ) : detail.late ? (
        <Notice tone="neutral" title="You already sent an ETA">You can send a new one below if it has changed.</Notice>
      ) : null}
      <Card title="Running late? Send your ETA">
        <div className="grid grid-cols-4 gap-2">
          {[10, 20, 30, 45].map((option) => (
            <button key={option} type="button" data-testid={`eta-${option}`} onClick={() => setMinutes(option)} className={`min-h-12 rounded-xl border text-sm font-semibold ${minutes === option ? "border-brand-500 bg-brand-500 text-white" : "border-border bg-background"}`}>
              {option} min
            </button>
          ))}
        </div>
        <TextBox label="What's going on? (optional)" value={reason} onChange={setReason} placeholder="Traffic, car trouble…" testId="delay-reason" />
        <Action
          disabled={minutes === null}
          busy={busy === "delay"}
          testId="send-eta"
          onPress={() =>
            void act("delay", async () => {
              const result = await reportDelay({ token, etaMinutes: minutes!, reason: reason || undefined });
              setSent(result.etaWords);
              clearReason();
            })
          }
        >
          Send ETA
        </Action>
      </Card>
      <Card title="Can't make it at all?">
        {cannotOpen ? (
          <>
            <p className="text-sm text-muted-foreground">This takes you off the job so the office can find cover. It cannot be undone from here.</p>
            <TextBox label="What happened?" value={reason} onChange={setReason} testId="cannot-reason" />
            <div className="flex gap-2">
              <Action kind="secondary" onPress={() => setCannotOpen(false)}>
                Go back
              </Action>
              <Action kind="danger" busy={busy === "cannot"} testId="confirm-cannot" onPress={() => void act("cannot", async () => {
                await cannot({ token, reason });
                clearReason();
              })}>
                I can&apos;t attend
              </Action>
            </div>
          </>
        ) : (
          <Action kind="secondary" onPress={() => setCannotOpen(true)} testId="cannot">
            I can&apos;t make this job
          </Action>
        )}
      </Card>
      <Problem message={problem} />
    </>
  );
}

function Checklist({ token, detail, locked }: { token: string; detail: Detail; locked: boolean }) {
  const setItem = useMutation(api.links.setChecklistItem);
  const { busy, problem, act } = useAct();
  const [skipping, setSkipping] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (detail.checklist.length === 0) {
    return (
      <Card title="Checklist">
        <p className="text-sm text-muted-foreground">No checklist was set for this job. Work from the scope above.</p>
      </Card>
    );
  }
  const done = detail.checklist.filter((item) => item.state !== "pending").length;
  return (
    <Card title={`Checklist · ${done} of ${detail.checklist.length}`}>
      <ul className="flex flex-col divide-y divide-border">
        {detail.checklist.map((item, index) => {
          const itemPhotos = detail.photos.item.filter((entry) => entry.itemId === item.id);
          return (
            <li key={item.id} className="flex flex-col gap-2 py-3" data-testid={`item-${index}`}>
              {item.section && detail.checklist[index - 1]?.section !== item.section ? <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{item.section}</p> : null}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className={`text-sm font-medium ${item.state === "skipped" ? "line-through" : ""}`}>{item.label}</span>
                  {item.state === "done" ? <span className="text-xs text-muted-foreground">Done by {item.by}</span> : null}
                  {item.state === "skipped" ? <span className="text-xs text-muted-foreground">Skipped by {item.by}: {item.skipReason}</span> : null}
                  {item.requiresPhoto && item.state === "pending" ? <span className="text-xs text-muted-foreground">Needs a photo</span> : null}
                </div>
                {locked ? null : item.state === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm" onClick={() => { setSkipping(item.id); setReason(""); }} data-testid={`skip-${index}`}>
                      Skip
                    </button>
                    <button type="button" disabled={busy !== null} className="min-h-10 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(item.id, () => setItem({ token, itemId: item.id, state: "done" }))} data-testid={`done-${index}`}>
                      Done
                    </button>
                  </div>
                ) : (
                  <button type="button" disabled={busy !== null} className="min-h-10 shrink-0 rounded-lg border border-border px-3 text-sm" onClick={() => void act(item.id, () => setItem({ token, itemId: item.id, state: "pending" }))}>
                    Undo
                  </button>
                )}
              </div>
              {item.requiresPhoto ? <Photos token={token} kind="item" itemId={item.id} photos={itemPhotos} locked={locked} title="Photo for this item" /> : null}
              {skipping === item.id ? (
                <div className="flex flex-col gap-2">
                  <TextBox label="Why is it skipped?" value={reason} onChange={setReason} testId="skip-reason" />
                  <div className="flex gap-2">
                    <Action kind="secondary" onPress={() => setSkipping(null)}>
                      Cancel
                    </Action>
                    <Action busy={busy === item.id} testId="confirm-skip" onPress={() => void act(item.id, async () => {
                      await setItem({ token, itemId: item.id, state: "skipped", skipReason: reason });
                      setSkipping(null);
                    })}>
                      Skip item
                    </Action>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Problem message={problem} />
    </Card>
  );
}

const REPORT_STATUS: Record<string, string> = { awaiting_decision: "Waiting for the office to decide", acknowledged: "Seen by the office", approved: "Approved by the office", declined: "Declined by the office" };

function Reports({ token, detail, locked }: { token: string; detail: Detail; locked: boolean }) {
  const report = useMutation(api.links.report);
  const { busy, problem, act } = useAct();
  const [kind, setKind] = useState<"condition" | "addon_request">("condition");
  const [text, setText, clearText] = useDraft(`report.${linkKey(token)}`);
  const shown = detail.reports.filter((entry) => entry.kind !== "incomplete");
  return (
    <Card title="Something unexpected, or an add-on?">
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shown.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-border p-3 text-sm" data-testid="report">
              <p>{entry.text}</p>
              <p className="text-xs text-muted-foreground">
                {entry.kind === "addon_request" ? "Add-on request" : "Reported condition"} · {REPORT_STATUS[entry.status]}
                {entry.decisionNote ? `: ${entry.decisionNote}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {locked ? null : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["condition", "addon_request"] as const).map((option) => (
              <button key={option} type="button" onClick={() => setKind(option)} className={`min-h-10 rounded-lg border text-sm font-medium ${kind === option ? "border-brand-500 bg-brand-500 text-white" : "border-border"}`} data-testid={`kind-${option}`}>
                {option === "condition" ? "Report a condition" : "Request an add-on"}
              </button>
            ))}
          </div>
          <TextBox label={kind === "condition" ? "What did you find?" : "What is being asked for?"} value={text} onChange={setText} testId="report-text" />
          {kind === "addon_request" ? <p className="text-xs text-muted-foreground">This goes to the office to decide. Keep to the original scope until they answer.</p> : null}
          <Action kind="secondary" busy={busy === "report"} disabled={text.trim().length < 3} testId="send-report" onPress={() => void act("report", async () => {
            await report({ token, kind, text });
            clearText();
          })}>
            Send to the office
          </Action>
        </>
      )}
      <Problem message={problem} />
    </Card>
  );
}

function Finish({ token, detail }: { token: string; detail: Detail }) {
  const submit = useMutation(api.links.submitJob);
  const { busy, problem, act } = useAct();
  const [incomplete, setIncomplete] = useState(false);
  const [note, setNote, clearNote] = useDraft(`finish.${linkKey(token)}`);
  const ready = detail.beforeSubmit.length === 0;
  return (
    <Card title="Finish the job">
      {ready ? (
        <p className="text-sm text-muted-foreground">Everything needed is in. Submit when you are done.</p>
      ) : (
        <ul className="list-disc pl-5 text-sm text-muted-foreground" data-testid="before-submit">
          {detail.beforeSubmit.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}
      {incomplete ? <TextBox label="What could not be finished, and why?" value={note} onChange={setNote} testId="incomplete-note" /> : null}
      <Action busy={busy === "submit"} disabled={incomplete ? note.trim().length < 3 : !ready} testId="submit" onPress={() => void act("submit", async () => {
        await submit({ token, incomplete, note: incomplete ? note : undefined });
        clearNote();
      })}>
        {incomplete ? "Submit as incomplete" : "Submit job"}
      </Action>
      <button type="button" className="text-sm font-medium text-brand-600" onClick={() => setIncomplete((value) => !value)} data-testid="toggle-incomplete">
        {incomplete ? "Everything was finished after all" : "Something could not be finished"}
      </button>
      <Problem message={problem} />
    </Card>
  );
}

/** The assigned job. `view` picks the part a text linked to; the full page has all of it. */
export function JobPage({ token, view }: { token: string; view: "job" | "delay" | "photos" }) {
  const now = useNow();
  // The current minute goes with the request, so photo addresses refresh before they stop working.
  const data = useQuery(api.links.job, now ? { token, asOf: now } : "skip");
  const checkIn = useMutation(api.links.checkInJob);
  const { busy, problem, act } = useAct();
  if (data === undefined) return <Loading what="your job" />;
  const detail = data.detail;
  if (!detail) {
    const closed = CLOSED[data.state] ?? CLOSED.ended;
    return (
      <Page company={data.company} title="Your job">
        <Notice tone="neutral" title={closed.title} testId={`state-${data.state}`}>
          {closed.body}
        </Notice>
      </Page>
    );
  }
  const submitted = data.state === "submitted";
  const checkedIn = detail.checkedInAt !== null;
  const back = (
    <Link href={`/c/job/${token}`} className="text-sm font-semibold text-brand-600" data-testid="back-to-job">
      ← Back to your job
    </Link>
  );

  if (view === "delay") {
    return (
      <Page company={data.company} title="Running late or can't make it">
        <p className="text-sm text-muted-foreground">Your job: {detail.when}.</p>
        <Delay token={token} detail={detail} />
        {back}
      </Page>
    );
  }
  if (view === "photos") {
    return (
      <Page company={data.company} title="Job photos">
        <p className="text-sm text-muted-foreground">Your job: {detail.when}.</p>
        {checkedIn ? (
          <>
            <Photos token={token} kind="before" photos={detail.photos.before} required={detail.required.before} locked={submitted} title="Before photos" />
            <Photos token={token} kind="after" photos={detail.photos.after} required={detail.required.after} locked={submitted} title="After photos" />
          </>
        ) : (
          <Notice tone="warn" title="Check in first">Photos open once you have checked in on your job page.</Notice>
        )}
        {back}
      </Page>
    );
  }

  const address = detail.address;
  const mapQuery = address ? encodeURIComponent(`${address.line1}, ${address.city}, ${address.region} ${address.postalCode}`) : "";
  return (
    <Page company={data.company} title={`Your job${detail.customerFirstName ? ` for ${detail.customerFirstName}` : ""}`}>
      {submitted ? (
        <Notice tone="good" title="Submitted for review" testId="state-submitted">
          Thanks, {data.cleanerFirstName}. The office will review the visit. This is not an approval and does not mean payment has been made.
        </Notice>
      ) : null}
      <Card>
        <Row label="When">{detail.when}</Row>
        <Row label="How long">{detail.duration}</Row>
        {detail.mustFinishBy ? <Row label="Must finish by">{detail.mustFinishBy}</Row> : null}
        <Row label="Your role">{detail.role}</Row>
        <Row label="Estimated pay">{detail.estimatedPay}</Row>
        {detail.crew.length > 1 ? <Row label="Crew">{detail.crew.map((member) => `${member.name}${member.you ? " (you)" : ""}`).join(", ")}</Row> : null}
      </Card>
      <Card title="Where">
        {address ? (
          <>
            <p className="text-sm font-medium" data-testid="address">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
              <br />
              {address.city}, {address.region} {address.postalCode}
            </p>
            <a className="text-sm font-semibold text-brand-600" href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`} target="_blank" rel="noreferrer noopener">
              Open in maps
            </a>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No address is on file. Contact the office.</p>
        )}
        <p className="text-sm">
          <span className="text-muted-foreground">Getting in: </span>
          {detail.accessInstructions ?? "No access instructions on file."}
        </p>
      </Card>
      <Card title={`${detail.serviceType} · scope`}>
        <p className="text-sm whitespace-pre-line">{detail.scope}</p>
        {detail.instructions ? <p className="text-sm whitespace-pre-line"><span className="text-muted-foreground">Instructions: </span>{detail.instructions}</p> : null}
      </Card>

      {checkedIn ? (
        <Notice tone="good" title="Checked in" testId="checked-in" />
      ) : (
        <Card title="When you arrive">
          <Action busy={busy === "check-in"} testId="check-in" onPress={() => void act("check-in", async () => {
            await checkIn({ token, ...(await position()) });
          })}>
            Check in
          </Action>
          <p className="text-xs text-muted-foreground">Your phone may ask to share your location. Check-in works either way.</p>
          <Link href={`/c/job/${token}/delay`} className="text-sm font-semibold text-brand-600" data-testid="to-delay">
            Running late or can&apos;t make it?
          </Link>
          <Problem message={problem} />
        </Card>
      )}

      {checkedIn ? (
        <>
          <Photos token={token} kind="before" photos={detail.photos.before} required={detail.required.before} locked={submitted} title="Before photos" />
          <Checklist token={token} detail={detail} locked={submitted} />
          <Reports token={token} detail={detail} locked={submitted} />
          <Photos token={token} kind="after" photos={detail.photos.after} required={detail.required.after} locked={submitted} title="After photos" />
          {submitted ? null : <Finish token={token} detail={detail} />}
        </>
      ) : null}
    </Page>
  );
}
