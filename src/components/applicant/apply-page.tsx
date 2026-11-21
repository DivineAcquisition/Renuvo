"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Action, Card, Loading, Notice, Page, Problem, problemWords, Row } from "@/components/cleaner/shell";
import { Check } from "@/components/icons";
import { SelectInput } from "@/components/app/form";

type Answer = string | number | boolean | string[];
type Answers = Record<string, Answer>;
type Field = { key: string; label: string; kind: "text" | "long_text" | "email" | "phone" | "number" | "yes_no" | "choice" | "multi"; required: boolean; options?: string[]; help?: string; section: "you" | "experience" | "availability" | "role" };

const STEPS = [
  { id: "you", title: "About you" },
  { id: "experience", title: "Your experience" },
  { id: "availability", title: "When and where you can work" },
  { id: "role", title: "About this role" },
] as const;

const CLOSED: Record<string, { tone: "neutral" | "warn" | "good"; title: string; body: string }> = {
  submitted: { tone: "good", title: "Your application is in", body: "Thank you. The hiring team will review what you sent. If they need anything else, or want to arrange a conversation, they will email you. Sending an application does not guarantee an interview or a job." },
  withdrawn: { tone: "neutral", title: "You withdrew this application", body: "Nothing more will be sent to you about it." },
  closed: { tone: "neutral", title: "This application is closed", body: "If you think this is a mistake, reply to the email that brought you here." },
  role_closed: { tone: "neutral", title: "This role is not taking applications right now", body: "Reply to the email that brought you here if you have questions." },
  expired: { tone: "warn", title: "This link has expired", body: "Reply to the email that brought you here and ask for a new link. What you saved is kept." },
  revoked: { tone: "neutral", title: "This link is no longer active", body: "Use the newest link you were sent, or reply to the email that brought you here." },
};

const inputClass = "min-h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500/40";
// The selection system's look for the applicant's choices: a visible tick on what is chosen, never colour alone.
const choiceClass = "inline-flex items-center justify-center gap-1.5 border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500/50 motion-reduce:transition-none";
const choiceOn = "border-brand-500 bg-brand-500 text-white";
const choiceOff = "border-border bg-background hover:border-brand-500/40";

function FieldInput({ field, value, onChange }: { field: Field; value: Answer | undefined; onChange: (value: Answer | undefined) => void }) {
  const id = `field-${field.key}`;
  if (field.kind === "yes_no") {
    // Consent-style statements are a tick box; questions are Yes or No.
    if (field.key === "smsConsent") {
      return (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" data-testid={id} className="mt-1 size-5 shrink-0" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    }
    return (
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{field.label}{field.required ? " *" : ""}</legend>
        {/* Yes and No are exclusive, so they are radios. Nothing is chosen until the applicant answers. */}
        <div className="flex gap-2" role="radiogroup" aria-label={field.label}>
          {[true, false].map((option) => (
            <button key={String(option)} type="button" role="radio" data-testid={`${id}-${option ? "yes" : "no"}`} aria-checked={value === option} onClick={() => onChange(option)} className={`${choiceClass} min-h-12 flex-1 rounded-xl px-4 text-base ${value === option ? choiceOn : choiceOff}`}>
              {value === option ? <Check className="size-4" aria-hidden /> : null}
              {option ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (field.kind === "multi") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{field.label}{field.required ? " *" : ""}</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label={field.label}>
          {(field.options ?? []).map((option) => {
            const on = chosen.includes(option);
            return (
              <button key={option} type="button" role="checkbox" data-testid={`${id}-${option}`} aria-checked={on} onClick={() => onChange(on ? chosen.filter((entry) => entry !== option) : [...chosen, option])} className={`${choiceClass} min-h-11 rounded-full px-4 text-sm ${on ? choiceOn : choiceOff}`}>
                {on ? <Check className="size-3.5" aria-hidden /> : null}
                {option}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }
  const label = (
    <span className="font-medium">
      {field.label}
      {field.required ? " *" : ""}
    </span>
  );
  if (field.kind === "choice") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <SelectInput data-testid={id} className={`${inputClass} select-native cursor-pointer pr-10`} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)}>
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </SelectInput>
      </label>
    );
  }
  if (field.kind === "long_text") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <textarea data-testid={id} rows={4} maxLength={2000} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base outline-none focus:border-brand-500" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} />
      </label>
    );
  }
  if (field.kind === "number") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <input data-testid={id} type="number" inputMode="decimal" min={0} className={inputClass} value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input data-testid={id} type={field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "text"} autoComplete={field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : field.key === "fullName" ? "name" : "off"} maxLength={160} className={inputClass} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} />
      {field.help ? <span className="text-xs text-muted-foreground">{field.help}</span> : null}
    </label>
  );
}

function words(value: Answer | undefined): string {
  if (value === undefined || value === "") return "Not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return Array.isArray(value) ? value.join(", ") || "Not answered" : String(value);
}

const unanswered = (field: Field, answers: Answers) => {
  const value = answers[field.key];
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
};

/**
 * The application. Loading it only reads. What the applicant enters is saved to the server at each step
 * and whenever they ask, so they can leave and come back with the same link on any device. Submitting is
 * its own button on the review step, behind a confirmation.
 */
export function ApplyPage({ token }: { token: string }) {
  const data = useQuery(api.applicantPages.application, { token });
  const save = useMutation(api.applicantPages.saveDraft);
  const submit = useMutation(api.applicantPages.submit);
  const withdraw = useMutation(api.applicantPages.withdraw);
  const uploadUrl = useMutation(api.applicantPages.fileUploadUrl);
  const attach = useMutation(api.applicantPages.attachFile);
  const removeFile = useMutation(api.applicantPages.removeFile);

  const [answers, setAnswers] = useState<Answers | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attested, setAttested] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const serverAnswers = data?.form?.answers;
  useEffect(() => {
    // The saved draft is taken from the server once, when the page first has it. After that the page's own copy is the one being edited.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (serverAnswers && answers === null) setAnswers(serverAnswers as Answers);
  }, [serverAnswers, answers]);

  if (data === undefined) return <Loading what="your application" />;
  const form = data.form;
  if (data.state !== "open" || !form) {
    const closed = CLOSED[data.state] ?? CLOSED.closed;
    return (
      <Page company={data.company} title={`${data.role} application`}>
        <Notice tone={closed.tone} title={closed.title} testId={`state-${data.state}`}>
          {closed.body}
        </Notice>
      </Page>
    );
  }
  if (answers === null) return <Loading what="your application" />;

  const fields = form.fields as Field[];
  const steps = STEPS.filter((entry) => fields.some((field) => field.section === entry.id));
  const review = step >= steps.length;
  const current = review ? [] : fields.filter((field) => field.section === steps[step].id);
  const missingHere = current.filter((field) => field.required && unanswered(field, answers));
  const missingAll = fields.filter((field) => field.required && unanswered(field, answers));

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setProblem(null);
    setSaved(false);
    try {
      await action();
    } catch (error) {
      setProblem(problemWords(error));
    } finally {
      setBusy(null);
    }
  };
  const saveNow = (then?: () => void) =>
    run("save", async () => {
      await save({ token, answers });
      setSaved(true);
      then?.();
    });
  const set = (key: string, value: Answer | undefined) => {
    setSaved(false);
    setAnswers((before) => {
      const next = { ...(before ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const upload = (file: File) =>
    run("upload", async () => {
      const url = await uploadUrl({ token });
      const sent = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!sent.ok) throw new Error("upload failed");
      const { storageId } = (await sent.json()) as { storageId: Id<"_storage"> };
      await attach({ token, storageId, kind: form.files.length === 0 ? "resume" : "supporting", fileName: file.name, clientKey: `${file.name}-${file.size}-${file.lastModified}`.slice(0, 80).padEnd(8, "0") });
    });

  return (
    <Page company={data.company} title={`${data.role} application`}>
      {step === 0 ? (
        <Card>
          <p className="text-sm">
            {data.firstName ? `Hi ${data.firstName}. ` : ""}Thank you for applying to {data.company}. This is the next step: a few questions about your experience and when you can work.
          </p>
          <p className="text-sm text-muted-foreground">Your answers are saved as you go. You can stop and come back with the same link. Nothing is sent to the hiring team until you submit on the last step.</p>
          <Row label="Where">{form.about.location}</Row>
          <Row label="Availability needed">{form.about.availability}</Row>
        </Card>
      ) : null}
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase" data-testid="step">
        {review ? "Review and submit" : `Step ${step + 1} of ${steps.length + 1}: ${steps[step].title}`}
      </p>

      {review ? (
        <>
          <Card title="Check your answers">
            {fields.filter((field) => field.key !== "smsConsent").map((field) => (
              <Row key={field.key} label={field.label}>
                <span data-testid={`review-${field.key}`}>{words(answers[field.key])}</span>
              </Row>
            ))}
            <Row label="May we text you about this application?">{answers.smsConsent === true ? "Yes" : "No"}</Row>
          </Card>
          <Card title="Resume or supporting files (optional)">
            {form.files.map((file) => (
              <div key={file.attachmentId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{file.fileName}</span>
                <button type="button" className="shrink-0 text-red-600 underline" disabled={busy !== null} onClick={() => void run("remove", async () => void (await removeFile({ token, attachmentId: file.attachmentId })))}>
                  Remove
                </button>
              </div>
            ))}
            {form.files.length < form.maxFiles ? (
              <>
                <input ref={fileInput} type="file" className="hidden" data-testid="file-input" accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
                <Action kind="secondary" busy={busy === "upload"} disabled={busy !== null} onPress={() => fileInput.current?.click()}>
                  Add a file
                </Action>
                <p className="text-xs text-muted-foreground">PDF, Word, text, JPG or PNG, up to 10 MB. Please do not upload ID documents, bank details or tax forms.</p>
              </>
            ) : null}
          </Card>
          {missingAll.length > 0 ? (
            <Notice tone="warn" title="Some required questions are not answered" testId="missing">
              {missingAll.map((field) => field.label).join("; ")}
            </Notice>
          ) : null}
          <label className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
            <input type="checkbox" data-testid="attest" className="mt-1 size-5 shrink-0" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
            <span>{form.attestation}</span>
          </label>
        </>
      ) : (
        <Card title={steps[step].title}>
          {current.map((field) => (
            <FieldInput key={field.key} field={field} value={answers[field.key]} onChange={(value) => set(field.key, value)} />
          ))}
        </Card>
      )}

      <Problem message={problem} />
      {saved ? <p role="status" className="text-sm text-muted-foreground" data-testid="saved">Saved. You can close this page and come back with the same link.</p> : null}

      <div className="flex flex-col gap-2">
        {review ? (
          <Action busy={busy === "submit"} disabled={busy !== null || !attested || missingAll.length > 0} onPress={() => void run("submit", async () => void (await submit({ token, answers, attested })))} testId="submit">
            Submit application
          </Action>
        ) : (
          <Action busy={busy === "save"} disabled={busy !== null || missingHere.length > 0} onPress={() => void saveNow(() => setStep(step + 1))} testId="next">
            Save and continue
          </Action>
        )}
        {!review && missingHere.length > 0 ? <p className="text-xs text-muted-foreground">Answer the questions marked * to continue.</p> : null}
        <div className="flex gap-2">
          {step > 0 ? (
            <Action kind="secondary" disabled={busy !== null} onPress={() => setStep(step - 1)} testId="back">
              Back
            </Action>
          ) : null}
          <Action kind="secondary" busy={busy === "save" && review} disabled={busy !== null} onPress={() => void saveNow()} testId="save-later">
            Save for later
          </Action>
        </div>
        {confirmWithdraw ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-border p-4">
            <p className="text-sm font-medium">Withdraw your application? We will not contact you about it again.</p>
            <div className="flex gap-2">
              <Action kind="secondary" disabled={busy !== null} onPress={() => setConfirmWithdraw(false)}>Keep it</Action>
              <Action kind="danger" busy={busy === "withdraw"} disabled={busy !== null} onPress={() => void run("withdraw", async () => void (await withdraw({ token })))} testId="confirm-withdraw">Yes, withdraw</Action>
            </div>
          </div>
        ) : (
          <button type="button" className="self-center py-2 text-sm text-muted-foreground underline" onClick={() => setConfirmWithdraw(true)} data-testid="withdraw">
            I no longer want to apply
          </button>
        )}
      </div>
    </Page>
  );
}
