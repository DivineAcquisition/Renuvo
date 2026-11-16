"use client";

import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { driveIdFrom, pickerConfig, pickFromDrive } from "@/lib/app/google-picker";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Feature = "drive" | "calendar" | "business_profile" | "ads" | "conversions";
const PURPOSES = ["photos", "resumes", "agreements", "reports", "creative", "documents"] as const;

/** What Google sent the Owner back with, in words. */
function resultWords(result: string, labels: Record<string, string>): string {
  if (result === "connected") return "Connected. Now choose what Selestial may use for that tool below.";
  if (result.startsWith("partial:")) return `Google granted only part of what ${result.slice(8).split(",").map((f) => labels[f] ?? f).join(", ")} needs, so it stays off. Reconnect it and allow everything Google asks for.`;
  if (result === "different_account") return "You signed in with a different Google account than the one this tool uses. Nothing changed. To switch accounts, choose “Use a different Google account” on that tool.";
  if (result === "no_refresh_token") return "Google did not give lasting access, so nothing was connected. Try again and allow access.";
  if (result === "declined") return "You declined at Google. Nothing was connected.";
  if (result === "expired") return "That sign-in had already been used or took longer than ten minutes. Start again.";
  return "That tool was not connected. Try again.";
}

/** What each kind of chosen item is, in words. */
const KIND_WORDS: Record<string, string> = {
  drive_source: "Drive folder Selestial reads",
  drive_output: "Drive folder Selestial saves to",
  calendar_sync: "Calendar for jobs and interviews",
  calendar_busy: "Calendar for busy times",
  business_location: "Business Profile location",
  ads_account: "Google Ads account",
  conversion_destination: "Conversion action",
};

const DRAFT_WORDS: Record<string, string> = { draft: "Draft", approved: "Approved", created_paused: "Created, paused", active: "Running", failed: "Couldn't be created" };

const ACCESS_WORDS = { verified: "Checked with Google", unverified: "Checking with Google…", lost: "Not reachable" } as const;

export function GoogleSettings() {
  const { companyId, role } = useCompany();
  const status = useQuery(api.google.status, { companyId });
  const result = useSearchParams().get("result");
  if (!status) return <Skeleton className="h-96 rounded-2xl" />;
  const owner = status.canManage;
  const labels = Object.fromEntries(status.tools.map((tool) => [tool.feature, tool.label]));
  const manager = canManage(role);
  return (
    <div className="grid gap-5">
      {result ? (
        <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-strong">
          {resultWords(result, labels)}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">Each Google tool is connected on its own, with whichever Google account you choose for it, and can be disconnected without affecting the others. This is separate from signing in to Selestial with Google.</p>
      {!status.ready && owner ? <p className="text-sm text-muted-foreground">Connecting Google isn&apos;t available yet. Selestial&apos;s team needs to finish setting it up for your account.</p> : null}
      {status.tools.map((tool) => (
        <ToolCard key={tool.feature} tool={tool} owner={owner} ready={status.ready} companyId={companyId} platform={status.platform}>
          {tool.feature === "drive" && tool.granted ? <DrivePanel companyId={companyId} manager={manager} /> : null}
          {tool.feature === "calendar" && tool.granted ? <CalendarPanel companyId={companyId} manager={manager} /> : null}
          {tool.feature === "business_profile" && tool.granted ? <ReviewsPanel companyId={companyId} manager={manager} /> : null}
          {tool.feature === "ads" ? <LeadsPanel companyId={companyId} owner={owner} /> : null}
          {tool.feature === "ads" && tool.granted ? <AdsPanel companyId={companyId} owner={owner} /> : null}
          {tool.feature === "conversions" && tool.granted ? <ConversionsPanel companyId={companyId} owner={owner} /> : null}
        </ToolCard>
      ))}
    </div>
  );
}

type Status = NonNullable<ReturnType<typeof useQuery<typeof api.google.status>>>;
type Tool = Status["tools"][number];

/** One Google tool: its own connection, account, chosen resources and disconnect. */
function ToolCard({ tool, owner, ready, companyId, platform, children }: { tool: Tool; owner: boolean; ready: boolean; companyId: Id<"companies">; platform: Status["platform"]; children: React.ReactNode }) {
  const start = useMutation(api.google.startConnect);
  const disconnect = useMutation(api.google.disconnect);
  const { busy, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const go = (differentAccount = false) =>
    void run(async () => {
      const { url } = await start({ companyId, feature: tool.feature as Feature, differentAccount, returnTo: window.location.origin });
      window.location.assign(url);
    });
  const connection = tool.connection;
  const state = !connection ? "Not connected" : connection.status === "expired" ? "Access ended: reconnect" : tool.granted ? "Connected" : "Not everything was granted: reconnect";
  return (
    <Panel title={tool.label} action={<span className={tool.granted ? "text-xs font-medium text-success" : "text-xs text-muted-foreground"}>{state}</span>}>
      <div className="grid gap-4 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">{tool.does}</p>
        {tool.needsPlatform.some((key) => platform.some((p) => p.key.includes(key) && !p.configured)) ? <p className="text-xs text-muted-foreground">Part of this needs a final setup step from Selestial&apos;s team.</p> : null}
        {connection ? (
          <div className="rounded-lg border border-border px-3 py-2 text-sm">
            <span className="font-medium text-strong">{connection.email}</span>{" "}
            <span className="text-muted-foreground">· connected {new Date(connection.connectedAt).toLocaleDateString()}</span>
            {connection.problem && connection.status !== "connected" ? <p className="mt-1 text-xs text-muted-foreground">{connection.problem}</p> : null}
          </div>
        ) : null}
        {owner ? (
          <div className="flex flex-wrap gap-2">
            {!connection ? (
              <Button type="button" variant="primary" disabled={busy || !ready} onClick={() => go()}>
                Connect {tool.label}
              </Button>
            ) : (
              <>
                {!tool.granted ? (
                  <Button type="button" variant="primary" disabled={busy || !ready} onClick={() => go()}>
                    Reconnect
                  </Button>
                ) : null}
                <Button type="button" variant="outline" disabled={busy || !ready} onClick={() => go(true)}>
                  Use a different Google account
                </Button>
                {confirming ? (
                  <Button type="button" variant="destructive" disabled={busy} onClick={() => void run(async () => { await disconnect({ companyId, feature: tool.feature as Feature }); setConfirming(false); })}>
                    Disconnect now: this tool’s Google work stops
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                    Disconnect
                  </Button>
                )}
              </>
            )}
          </div>
        ) : !connection ? (
          <p className="text-xs text-muted-foreground">Only the Owner connects Google tools and chooses what Selestial may use.</p>
        ) : null}
        <FormError message={error} />
        {tool.granted ? <Resources tool={tool} owner={owner} companyId={companyId} /> : null}
        {children}
      </div>
    </Panel>
  );
}

function Resources({ tool, owner, companyId }: { tool: Tool; owner: boolean; companyId: Id<"companies"> }) {
  const remove = useMutation(api.google.removeResource);
  const { busy, error, run } = useRun();
  return (
    <div className="grid gap-3">
      <span className="text-sm font-medium text-strong">What Selestial may use</span>
      {tool.resources.length === 0 ? <p className="text-sm text-muted-foreground">Nothing chosen yet. Selestial can use only what is listed here.</p> : null}
      <ul className="grid gap-2">
        {tool.resources.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-strong">
                {r.label} <span className="font-normal text-muted-foreground">· {KIND_WORDS[r.kind] ?? "Shared item"}{r.purpose ? ` for ${r.purpose}` : ""}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {ACCESS_WORDS[r.access]}
                {r.accessNote ? `: ${r.accessNote}` : ""}
              </span>
            </span>
            {owner ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => remove({ companyId, resourceId: r.id }))}>
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {owner ? (
        <>
          {tool.feature === "drive" ? <ChooseDrive companyId={companyId} email={tool.connection?.email} /> : null}
          {tool.feature === "calendar" ? <ChooseFromList companyId={companyId} kind="calendars" title="Calendars" options={[{ kind: "calendar_sync", label: "Put visits and interviews here" }, { kind: "calendar_busy", label: "Use busy times from here" }]} /> : null}
          {tool.feature === "business_profile" ? <ChooseFromList companyId={companyId} kind="locations" title="Business Profile locations" options={[{ kind: "business_location", label: "Read reviews and reply (with approval)" }]} /> : null}
          {tool.feature === "ads" ? <ChooseFromList companyId={companyId} kind="ads_accounts" title="Google Ads accounts" options={[{ kind: "ads_account", label: "Read results, take Local Services leads, draft campaigns" }]} /> : null}
          {tool.feature === "conversions" ? <ChooseConversion companyId={companyId} /> : null}
        </>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

function ChooseDrive({ companyId, email }: { companyId: Id<"companies">; email?: string }) {
  const add = useMutation(api.google.addResource);
  const { busy, error, run, setError } = useRun();
  const [purpose, setPurpose] = useState<string>("knowledge");
  const [link, setLink] = useState("");
  const picker = pickerConfig() !== null;
  const save = (items: { id: string; name: string; mimeType?: string }[]) =>
    run(async () => {
      for (const item of items) await add({ companyId, kind: purpose === "knowledge" ? "drive_source" : "drive_output", externalId: item.id, label: item.name, purpose: purpose === "knowledge" ? undefined : purpose, detail: item.mimeType });
    });
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <span className="text-sm font-medium text-strong">Google Drive</span>
      <p className="text-xs text-muted-foreground">Selestial sees only files and folders chosen here or created by Selestial. Choosing a folder does not share the files already in it: pick those files too.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Use it for" className="min-w-48">
          <SelectInput value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="knowledge">Knowledge Chat may read</option>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                Save {p} here
              </option>
            ))}
          </SelectInput>
        </Field>
        {picker ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFromDrive({ folders: purpose !== "knowledge", loginHint: email }).then((items) => (items.length ? save(items) : undefined)).catch((e: Error) => setError(e.message))}>
            Choose in Google Drive
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={picker ? "Or paste a Drive link" : "Paste a Drive link or id"} className="min-w-64 flex-1">
          <TextInput value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
        </Field>
        <Button type="button" variant="outline" disabled={busy || !driveIdFrom(link)} onClick={() => void save([{ id: driveIdFrom(link)!, name: "Drive item" }]).then(() => setLink(""))}>
          Add
        </Button>
      </div>
      {!picker ? <p className="text-xs text-muted-foreground">Google’s file picker isn’t available yet. Paste a link to a folder or file instead; it works for anything Selestial can already open.</p> : null}
      <FormError message={error} />
    </div>
  );
}

type Kind = "calendar_sync" | "calendar_busy" | "business_location" | "ads_account";

function ChooseFromList({ companyId, kind, title, options }: { companyId: Id<"companies">; kind: "calendars" | "locations" | "ads_accounts"; title: string; options: { kind: Kind; label: string }[] }) {
  const choices = useQuery(api.google.choices, { companyId, kind });
  const refresh = useMutation(api.google.refreshChoices);
  const add = useMutation(api.google.addResource);
  const { busy, error, run } = useRun();
  const [target, setTarget] = useState<Kind>(options[0].kind);
  const [login, setLogin] = useState("");
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-strong">{title}</span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => refresh({ companyId, kind }))}>
          {choices ? "List again" : "List from Google"}
        </Button>
      </div>
      {options.length > 1 ? (
        <Field label="Use it to">
          <SelectInput value={target} onChange={(e) => setTarget(e.target.value as Kind)}>
            {options.map((o) => (
              <option key={o.kind} value={o.kind}>
                {o.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">{options[0].label}</p>
      )}
      {kind === "ads_accounts" ? (
        <Field label="Manager account id (only if access is through a manager account)">
          <TextInput value={login} onChange={(e) => setLogin(e.target.value)} placeholder="123-456-7890" />
        </Field>
      ) : null}
      {choices?.problem ? <p className="text-xs text-muted-foreground">{choices.problem}</p> : null}
      <ul className="grid gap-1">
        {(choices?.items ?? []).map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {item.label} {item.detail ? <span className="text-xs text-muted-foreground">· {item.detail}</span> : null}
            </span>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => add({ companyId, kind: target, externalId: item.id, label: item.label, detail: kind === "locations" ? item.detail : kind === "ads_accounts" ? login.replace(/\D/g, "") || undefined : undefined }))}>
              Choose
            </Button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </div>
  );
}

function ChooseConversion({ companyId }: { companyId: Id<"companies"> }) {
  const add = useMutation(api.google.addResource);
  const { busy, error, run } = useRun();
  const [account, setAccount] = useState("");
  const [action, setAction] = useState("");
  const [login, setLogin] = useState("");
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <span className="text-sm font-medium text-strong">Where booked jobs are reported</span>
      <p className="text-xs text-muted-foreground">The Google Ads conversion action that counts a booked job. Find its id in Google Ads under Goals › Conversions.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Ad account id">
          <TextInput value={account} onChange={(e) => setAccount(e.target.value)} placeholder="123-456-7890" />
        </Field>
        <Field label="Conversion action id">
          <TextInput value={action} onChange={(e) => setAction(e.target.value)} />
        </Field>
        <Field label="Manager account id (optional)">
          <TextInput value={login} onChange={(e) => setLogin(e.target.value)} />
        </Field>
      </div>
      <div>
        <Button type="button" variant="outline" disabled={busy || !/^\d{6,}$/.test(action.trim()) || account.replace(/\D/g, "").length !== 10} onClick={() => void run(() => add({ companyId, kind: "conversion_destination", externalId: action.trim(), label: `Conversion action ${action.trim()}`, detail: `${account.replace(/\D/g, "")}${login.replace(/\D/g, "") ? `:${login.replace(/\D/g, "")}` : ""}` }))}>
          Use this conversion action
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

function DrivePanel({ companyId, manager }: { companyId: Id<"companies">; manager: boolean }) {
  const sources = useQuery(api.googleDrive.sources, { companyId });
  const read = useMutation(api.googleDrive.importKnowledge);
  const schedule = useMutation(api.googleDrive.exportSchedule);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState<string | null>(null);
  const { role } = useCompany();
  return (
    <Panel title="Drive, Docs and Sheets">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <ul className="grid gap-2">
          {(sources ?? []).map((s) => (
            <li key={s.resourceId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium text-strong">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.files.length ? `${s.files.length} file${s.files.length === 1 ? "" : "s"} read: ${s.files.map((f) => f.name).join(", ")}` : "Not read yet."} New text is proposed as company knowledge for the Owner to confirm.</span>
              </span>
              {role === "owner" ? (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await read({ companyId, resourceId: s.resourceId }); setNote("Reading queued."); })}>
                  Read again
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {manager ? (
          <div>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { const r = await schedule({ companyId }); setNote(r.repeated ? "That export is already queued or done." : "The schedule export is queued. It appears in the reports folder when Google confirms it."); })}>
              Export the next two weeks to a Google Sheet
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">Agreements are exported as Google Docs from each agreement’s page. An export is a copy for reading: it never signs or changes the agreement.</p>
        {note ? <p role="status" className="text-sm text-strong">{note}</p> : null}
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function CalendarPanel({ companyId, manager }: { companyId: Id<"companies">; manager: boolean }) {
  const sync = useMutation(api.googleCalendar.syncNow);
  const [from] = useState(() => Date.now());
  const busyTimes = useQuery(api.googleCalendar.busy, { companyId, from, to: from + 7 * 86_400_000 });
  const { busy, error, run } = useRun();
  const [note, setNote] = useState<string | null>(null);
  return (
    <Panel title="Calendar">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">Visits and confirmed interviews are copied to the calendar you chose every few minutes. Selestial stays the source: if someone moves or deletes one of these events in Google, a task asks a person to decide, and the visit is not changed.</p>
        {(busyTimes ?? []).map((row) => (
          <p key={row.calendarId} className="text-xs text-muted-foreground">
            {row.calendarId}: {row.problem ? `not readable (${row.problem})` : `${row.busy.length} busy block${row.busy.length === 1 ? "" : "s"} in the next week, read ${new Date(row.fetchedAt).toLocaleTimeString()}`}.
          </p>
        ))}
        {manager ? (
          <div>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { const r = await sync({ companyId }); setNote(r.repeated ? "A sync is already queued." : "Sync queued."); })}>
              Sync now
            </Button>
          </div>
        ) : null}
        {note ? <p role="status" className="text-sm text-strong">{note}</p> : null}
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function ReviewsPanel({ companyId, manager }: { companyId: Id<"companies">; manager: boolean }) {
  const reviews = useQuery(api.googleBusiness.reviews, { companyId });
  const syncNow = useMutation(api.googleBusiness.syncReviews);
  const draft = useMutation(api.googleBusiness.draftReply);
  const approve = useMutation(api.googleBusiness.approveReply);
  const { busy, error, run } = useRun();
  const [texts, setTexts] = useState<Record<string, string>>({});
  return (
    <Panel title="Business Profile reviews" action={manager ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => syncNow({ companyId }))}>Read reviews now</Button> : undefined}>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-xs text-muted-foreground">A reply is posted publicly only after an Owner or Manager approves its exact text. Review requests treat every customer with a finished visit the same, whatever they thought of it.</p>
        {reviews?.length === 0 ? <p className="text-sm text-muted-foreground">No reviews read yet.</p> : null}
        <ul className="grid gap-3">
          {(reviews ?? []).slice(0, 30).map((r) => {
            const text = texts[r._id] ?? r.draft ?? "";
            return (
              <li key={r._id} className="grid gap-2 rounded-lg border border-border p-3">
                <span className="text-sm font-medium text-strong">
                  {"★".repeat(r.stars)}
                  {"☆".repeat(Math.max(0, 5 - r.stars))} · {r.reviewer}
                </span>
                {r.comment ? <p className="text-sm">{r.comment}</p> : null}
                {r.existingReply ? <p className="text-xs text-muted-foreground">Reply on Google: {r.existingReply}</p> : null}
                <span className="text-xs text-muted-foreground">{r.state === "publishing" ? "Publishing…" : r.state === "failed" ? `Not published: ${r.problem ?? "Google refused it."}` : r.state === "published" ? "Replied" : r.state === "drafted" ? "Draft saved, not posted" : "No reply yet"}</span>
                {manager && r.state !== "publishing" ? (
                  <>
                    <TextArea rows={3} value={text} onChange={(e) => setTexts((now) => ({ ...now, [r._id]: e.target.value }))} placeholder="Write a reply" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busy || !text.trim()} onClick={() => void run(() => draft({ companyId, reviewId: r._id, text }))}>
                        Save draft
                      </Button>
                      <Button type="button" size="sm" variant="primary" disabled={busy || !text.trim()} onClick={() => void run(() => approve({ companyId, reviewId: r._id, text }))}>
                        Approve and post publicly
                      </Button>
                    </div>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function LeadsPanel({ companyId, owner }: { companyId: Id<"companies">; owner: boolean }) {
  const leads = useQuery(api.googleAds.leads, { companyId });
  const rotate = useMutation(api.googleAds.rotateLeadKey);
  const { busy, error, run } = useRun();
  const [shown, setShown] = useState<{ key: string; webhookUrl: string } | null>(null);
  if (!leads) return null;
  return (
    <Panel title="Google Ads lead forms and Local Services leads">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">Each lead reaches Sales once, matched to a customer already on file by email or phone. Local Services leads are read from the ad accounts you chose every 15 minutes.</p>
        {owner ? (
          <div className="grid gap-2 rounded-lg border border-border p-3">
            <span className="text-sm text-strong">{leads.hasKey ? `Lead form key made ${new Date(leads.keyCreatedAt!).toLocaleDateString()}.` : "No lead form key yet."}</span>
            {shown ? (
              <div className="grid gap-1 text-sm">
                <span>In Google Ads, open the lead form › Lead delivery › Webhook integration, and enter:</span>
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">URL: {shown.webhookUrl}</code>
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">Key: {shown.key}</code>
                <span className="text-xs text-muted-foreground">The key is shown only now. Selestial keeps only a fingerprint of it.</span>
              </div>
            ) : null}
            <div>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => setShown(await rotate({ companyId })))}>
                {leads.hasKey ? "Make a new key (the old one stops working)" : "Make a lead form key"}
              </Button>
            </div>
          </div>
        ) : null}
        <ul className="grid gap-1">
          {leads.leads.slice(0, 20).map((l) => (
            <li key={l._id} className="text-sm">
              {l.name ?? l.email ?? l.phone ?? "Lead"} <span className="text-xs text-muted-foreground">· {l.source === "local_services" ? "Local Services" : "Lead form"}{l.test ? " · Google test data" : ""} · {new Date(l.receivedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function AdsPanel({ companyId, owner }: { companyId: Id<"companies">; owner: boolean }) {
  const drafts = useQuery(api.googleAds.drafts, { companyId });
  const snapshots = useQuery(api.googleAds.snapshots, { companyId });
  const approve = useMutation(api.googleAds.approveCampaign);
  const activate = useMutation(api.googleAds.activateCampaign);
  const { busy, error, run } = useRun();
  return (
    <Panel title="Google Ads">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        {(snapshots ?? []).map((s) => (
          <div key={s.accountId} className="text-sm">
            <span className="font-medium text-strong">Account {s.accountId}</span> <span className="text-xs text-muted-foreground">· last 30 days, read {new Date(s.fetchedAt).toLocaleString()}</span>
            <ul className="mt-1 grid gap-0.5 text-xs">
              {s.rows.map((r) => (
                <li key={r.campaign}>
                  {r.campaign} ({r.status.toLowerCase()}): {r.clicks} clicks, ${(r.costMicros / 1e6).toFixed(2)}, {r.conversions} conversions
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Campaign drafts are made in Chat or here by a Manager and cost nothing. The Owner approves a draft and its daily budget to create it paused, and turns it on separately.</p>
        <ul className="grid gap-2">
          {(drafts ?? []).map((d) => (
            <li key={d._id} className="grid gap-1 rounded-lg border border-border p-3 text-sm">
              <span className="font-medium text-strong">{d.name}</span>
              <span className="text-xs text-muted-foreground">
                ${(d.dailyBudgetCents / 100).toFixed(2)} a day · {DRAFT_WORDS[d.state] ?? "Draft"} · {d.keywords.slice(0, 5).join(", ")}
                {d.problem ? ` · ${d.problem}` : ""}
              </span>
              {owner && (d.state === "draft" || d.state === "failed") ? (
                <div>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => approve({ companyId, draftId: d._id, confirmDailyBudgetCents: d.dailyBudgetCents }))}>
                    Approve ${(d.dailyBudgetCents / 100).toFixed(2)}/day and create paused
                  </Button>
                </div>
              ) : null}
              {owner && d.state === "created_paused" ? (
                <div>
                  <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void run(() => activate({ companyId, draftId: d._id, confirmDailyBudgetCents: d.dailyBudgetCents }))}>
                    Turn on: starts spending up to ${(d.dailyBudgetCents / 100).toFixed(2)}/day
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function ConversionsPanel({ companyId, owner }: { companyId: Id<"companies">; owner: boolean }) {
  const settings = useQuery(api.googleAds.conversionSettings, { companyId });
  const save = useMutation(api.googleAds.setConversionConsent);
  const { busy, error, run } = useRun();
  const [basis, setBasis] = useState("");
  const [userData, setUserData] = useState(true);
  const [personalization, setPersonalization] = useState(false);
  if (!settings) return null;
  return (
    <Panel title="Booked jobs reported to Google Ads">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">A visit booked by a customer who came from a Google ad is reported once, with its price, so Google Ads learns which clicks become customers. Nothing is reported until the Owner records the consent basis.</p>
        <p className="text-sm text-strong">{settings.consent ? `Reporting is on. Consent basis: ${settings.consent.basis}` : "Reporting is off."}</p>
        {owner ? (
          <div className="grid gap-2">
            <Field label="Consent basis (what your customers agreed to)">
              <TextArea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={userData} onChange={(e) => setUserData(e.target.checked)} /> Customers consented to ad user data</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={personalization} onChange={(e) => setPersonalization(e.target.checked)} /> Customers consented to ad personalization</label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || !basis.trim()} onClick={() => void run(() => save({ companyId, adUserData: userData, adPersonalization: personalization, basis }))}>
                Save and turn reporting on
              </Button>
              {settings.consent ? (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => save({ companyId, adUserData: false, adPersonalization: false, basis: "off", off: true }))}>
                  Turn reporting off
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <ul className="grid gap-1 text-xs">
          {settings.recent.slice(0, 10).map((c) => (
            <li key={c._id}>
              ${(c.valueCents / 100).toFixed(2)} · {({ queued: "Waiting to send", sent: "Sent to Google Ads", rejected: "Google Ads didn't accept it", skipped: "Not sent" } as Record<string, string>)[c.status] ?? "Recorded"}
              {c.reason ? ` · ${c.reason}` : ""}
            </li>
          ))}
        </ul>
        <FormError message={error} />
      </div>
    </Panel>
  );
}
