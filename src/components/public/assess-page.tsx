"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Action, Card, Loading, Notice, Page, Problem, problemWords } from "@/components/cleaner/shell";

import { api } from "../../../convex/_generated/api";
import { SelectInput } from "@/components/app/form";

/** The assessor's page at the property: what to record, photos, then finish. Saves as they go. */
export function AssessPage({ token }: { token: string }) {
  const view = useQuery(api.assessments.linkView, { token });
  const record = useMutation(api.assessments.linkRecord);
  const uploadUrl = useMutation(api.assessments.linkUploadUrl);
  const addPhoto = useMutation(api.assessments.linkAddPhoto);
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (view === undefined) return <Loading what="the walkthrough" />;
  if (view === null)
    return (
      <Page company={null} title="Link not found">
        <Notice tone="bad" title="This link doesn't work">Ask the office for a new one.</Notice>
      </Page>
    );

  const findings = () => {
    const out: Record<string, string | number | boolean> = {};
    for (const field of view.required) {
      const raw = values[field.key] ?? (view.findings[field.key] !== undefined ? String(view.findings[field.key]) : "");
      if (raw === "") continue;
      if (field.kind === "number") {
        const n = Number(raw);
        if (Number.isFinite(n)) out[field.key] = n;
      } else if (field.kind === "yes_no") out[field.key] = raw === "yes";
      else out[field.key] = raw;
    }
    return out;
  };
  const save = (finish: boolean) => {
    setProblem(null);
    setSaved(null);
    setBusy(true);
    record({ token, findings: findings(), finish, name: name || "Assessor" })
      .then(() => setSaved(finish ? "Walkthrough complete. The office will review the pricing." : "Saved."))
      .catch((caught: unknown) => setProblem(problemWords(caught)))
      .finally(() => setBusy(false));
  };
  const upload = async (file: File) => {
    setProblem(null);
    try {
      const url = await uploadUrl({ token });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = (await response.json()) as { storageId: string };
      await addPhoto({ token, storageId: storageId as never });
    } catch (caught) {
      setProblem(problemWords(caught));
    }
  };
  const closed = view.status === "completed" || view.status === "cancelled";

  return (
    <Page company={view.company} title={`Walkthrough: ${view.client}`}>
      <Card>
        <p className="text-sm">{view.address}</p>
        {view.scheduledAt ? <p className="text-xs text-muted-foreground">{new Date(view.scheduledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
        {view.siteContact ? (
          <p className="text-xs text-muted-foreground">
            Meet {view.siteContact.name}
            {view.siteContact.phone ? ` · ${view.siteContact.phone}` : ""}
          </p>
        ) : null}
      </Card>
      {closed ? <Notice tone="good" title={view.status === "completed" ? "Walkthrough complete" : "Cancelled"}>{view.completedBy ? `Recorded by ${view.completedBy}.` : null}</Notice> : null}
      <Card title="Record what you find">
        <p className="text-xs text-muted-foreground">Record only what you saw. Leave anything you couldn&apos;t check empty.</p>
        {view.required.map((field) => (
          <label key={field.key} className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{field.label}</span>
            {field.kind === "choice" ? (
              <SelectInput disabled={closed} className="min-h-11 rounded-xl border border-border bg-background px-3" value={values[field.key] ?? String(view.findings[field.key] ?? "")} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}>
                <option value="">Not checked</option>
                {field.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </SelectInput>
            ) : field.kind === "yes_no" ? (
              <SelectInput disabled={closed} className="min-h-11 rounded-xl border border-border bg-background px-3" value={values[field.key] ?? (view.findings[field.key] === undefined ? "" : view.findings[field.key] ? "yes" : "no")} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}>
                <option value="">Not checked</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </SelectInput>
            ) : field.kind === "number" ? (
              <input disabled={closed} type="number" inputMode="decimal" className="min-h-11 rounded-xl border border-border bg-background px-3 text-base" value={values[field.key] ?? String(view.findings[field.key] ?? "")} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} />
            ) : (
              <textarea disabled={closed} className="min-h-20 rounded-xl border border-border bg-background px-3 py-2 text-base" value={values[field.key] ?? String(view.findings[field.key] ?? "")} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} />
            )}
            <span className="text-xs text-muted-foreground">{field.why}</span>
          </label>
        ))}
      </Card>
      <Card title={`Photos (${view.photos.length})`}>
        <div className="grid grid-cols-3 gap-2">
          {/* Convex storage URLs, signed per request; next/image can't optimize them. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view.photos.map((photo, i) => (photo.url ? <img key={i} src={photo.url} alt={photo.caption ?? `Photo ${i + 1}`} className="aspect-square rounded-lg object-cover" /> : null))}
        </div>
        {!closed ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Add a photo</span>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        ) : null}
      </Card>
      {!closed ? (
        <Card>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Your name</span>
            <input className="min-h-11 rounded-xl border border-border bg-background px-3 text-base" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <Problem message={problem} />
          {saved ? <p className="text-sm text-emerald-700">{saved}</p> : null}
          <Action kind="secondary" busy={busy} onPress={() => save(false)}>
            Save
          </Action>
          <Action busy={busy} disabled={name.trim().length < 2} onPress={() => save(true)}>
            Finish walkthrough
          </Action>
        </Card>
      ) : null}
    </Page>
  );
}
