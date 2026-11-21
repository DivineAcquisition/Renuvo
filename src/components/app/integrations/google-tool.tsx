"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { driveIdFrom, pickerConfig, pickFromDrive } from "@/lib/app/google-picker";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";

export type Feature = "drive" | "calendar" | "business_profile" | "ads" | "conversions";
const PURPOSES = ["photos", "resumes", "agreements", "reports", "creative", "documents"] as const;

/** What Google sent the Owner back with, in words. */
export function googleResultWords(result: string): string {
  if (result === "connected") return "Connected. Now choose what Selestial may use below.";
  if (result.startsWith("partial:")) return "Google granted only part of what this tool needs, so it stays off. Reconnect and allow everything Google asks for.";
  if (result === "different_account") return "You signed in with a different Google account than the one this tool uses. Nothing changed. To switch, choose “Use a different Google account”.";
  if (result === "no_refresh_token") return "Google did not give lasting access, so nothing was connected. Try again and allow access.";
  if (result === "declined") return "You declined at Google. Nothing was connected.";
  if (result === "expired") return "That sign-in had already been used or took longer than ten minutes. Start again.";
  return "Not connected. Try again.";
}

const ACCESS_WORDS = { verified: "Ready", unverified: "Checking…", lost: "Needs attention" } as const;

const DRAFT_WORDS: Record<string, string> = { draft: "draft", approved: "approved, being created", created_paused: "ready, paused", active: "running", failed: "couldn’t be created" };
const REPORT_WORDS: Record<string, string> = { queued: "sending", sent: "reported", rejected: "not accepted", skipped: "not reported" };

const USE_WORDS: Record<string, (purpose: string | null) => string> = {
  drive_source: () => "your team can ask about it",
  drive_output: (purpose) => (purpose ? `${purpose} are saved here` : "files are saved here"),
  calendar_sync: () => "visits and interviews go here",
  calendar_busy: () => "busy times are respected",
  business_location: () => "reviews",
  ads_account: () => "ads and leads",
  conversion_destination: () => "booked visits are reported here",
};

type Status = NonNullable<ReturnType<typeof useQuery<typeof api.google.status>>>;
type Tool = Status["tools"][number];

/** Starts Google's sign-in for one tool, straight from its card. */
export function useConnectGoogle(feature: Feature) {
  const { companyId } = useCompany();
  const start = useMutation(api.google.startConnect);
  const { busy, error, run } = useRun();
  const connect = (differentAccount = false) =>
    void run(async () => {
      const { url } = await start({ companyId, feature, differentAccount, returnTo: window.location.origin });
      window.location.assign(url);
    });
  return { busy, error, connect };
}

/** Everything about one Google tool, shown inside its card once opened: account, what it may use, and its work. */
export function GoogleToolPanel({ feature, result }: { feature: Feature; result: string | null }) {
  const { companyId, role } = useCompany();
  const status = useQuery(api.google.status, { companyId });
  if (!status) return <Skeleton className="h-40 rounded-xl" />;
  const tool = status.tools.find((t) => t.feature === feature)!;
  const owner = status.canManage;
  const manager = canManage(role);
  const conversions = status.tools.find((t) => t.feature === "conversions")!;
  return (
    <div className="grid gap-4">
      {result ? (
        <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-strong">
          {googleResultWords(result)}
        </p>
      ) : null}
      <ToolConnection tool={tool} owner={owner} ready={status.ready} companyId={companyId} />
      {tool.feature === "drive" && tool.granted ? <DrivePanel companyId={companyId} manager={manager} /> : null}
      {tool.feature === "calendar" && tool.granted ? <CalendarPanel companyId={companyId} manager={manager} /> : null}
      {tool.feature === "business_profile" && tool.granted ? <ReviewsPanel companyId={companyId} manager={manager} /> : null}
      {tool.feature === "ads" ? <LeadsPanel companyId={companyId} owner={owner} /> : null}
      {tool.feature === "ads" && tool.granted ? <AdsPanel companyId={companyId} owner={owner} /> : null}
      {tool.feature === "ads" ? (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <span className="text-sm font-medium text-strong">{conversions.label}</span>
          <p className="text-xs text-muted-foreground">{conversions.does} Connected separately from Google Ads.</p>
          <ToolConnection tool={conversions} owner={owner} ready={status.ready} companyId={companyId} />
          {conversions.granted ? <ConversionsPanel companyId={companyId} owner={owner} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One tool's own connection: its account, reconnect, a different account, disconnect, and what it may use. */
function ToolConnection({ tool, owner, ready, companyId }: { tool: Tool; owner: boolean; ready: boolean; companyId: Id<"companies"> }) {
  const disconnect = useMutation(api.google.disconnect);
  const { busy: connecting, error: connectError, connect } = useConnectGoogle(tool.feature as Feature);
  const { busy, error, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const connection = tool.connection;
  if (!connection)
    return owner ? (
      <div>
        <Button type="button" variant="primary" disabled={connecting || !ready} onClick={() => connect()}>
          Connect {tool.label}
        </Button>
        <FormError message={connectError} />
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">Not connected. Only the Owner connects it.</p>
    );
  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-border px-3 py-2 text-sm">
        <span className="font-medium text-strong">{connection.email}</span>{" "}
        <span className="text-muted-foreground">· {connection.status === "expired" ? "access ended, reconnect" : tool.granted ? `connected ${new Date(connection.connectedAt).toLocaleDateString()}` : "not everything was granted, reconnect"}</span>
        {connection.problem && connection.status !== "connected" ? <p className="mt-1 text-xs text-muted-foreground">{connection.problem}</p> : null}
      </div>
      {owner ? (
        <div className="flex flex-wrap gap-2">
          {!tool.granted ? (
            <Button type="button" size="sm" variant="primary" disabled={connecting || !ready} onClick={() => connect()}>
              Reconnect
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={connecting || !ready} onClick={() => connect(true)}>
            Use a different Google account
          </Button>
          {confirming ? (
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { await disconnect({ companyId, feature: tool.feature as Feature }); setConfirming(false); })}>
              Disconnect now: this tool’s Google work stops
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      ) : null}
      <FormError message={error ?? connectError} />
      {tool.granted ? <Resources tool={tool} owner={owner} companyId={companyId} /> : null}
    </div>
  );
}

function Resources({ tool, owner, companyId }: { tool: Tool; owner: boolean; companyId: Id<"companies"> }) {
  const remove = useMutation(api.google.removeResource);
  const { busy, error, run } = useRun();
  return (
    <div className="grid gap-3">
      <span className="text-sm font-medium text-strong">What Selestial uses</span>
      {tool.resources.length === 0 ? <p className="text-sm text-muted-foreground">Nothing added yet.</p> : null}
      <ul className="grid gap-2">
        {tool.resources.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-strong">
                {r.label} <span className="font-normal text-muted-foreground">· {USE_WORDS[r.kind](r.purpose)}</span>
              </span>
              <span className="text-xs text-muted-foreground">{r.access === "verified" ? ACCESS_WORDS.verified : r.accessNote && r.access === "lost" ? r.accessNote : ACCESS_WORDS[r.access]}</span>
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
          {tool.feature === "calendar" ? <ChooseFromList companyId={companyId} kind="calendars" title="Your calendars" empty="No calendars found." options={[{ kind: "calendar_sync", label: "Put visits and interviews here" }, { kind: "calendar_busy", label: "Respect busy times here" }]} /> : null}
          {tool.feature === "business_profile" ? <ChooseFromList companyId={companyId} kind="locations" title="Your locations" empty="No locations found." options={[{ kind: "business_location", label: "Reviews" }]} /> : null}
          {tool.feature === "ads" ? <ChooseFromList companyId={companyId} kind="ads_accounts" title="Your ad accounts" empty="No ad accounts found." options={[{ kind: "ads_account", label: "Ads and leads" }]} /> : null}
          {tool.feature === "conversions" ? <ChooseFromList companyId={companyId} kind="conversion_actions" title="Where to report booked visits" empty="Add a Google Ads account first, then pick a conversion here." options={[{ kind: "conversion_destination", label: "Booked visits" }]} /> : null}
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
      <span className="text-sm font-medium text-strong">Add files or folders</span>
      <p className="text-xs text-muted-foreground">Selestial only sees what you add here. Adding a folder doesn’t include the files already in it, so add those files too.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add" className="min-w-48">
          <SelectInput value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="knowledge">Information your team can ask about</option>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                A folder to save {p} in
              </option>
            ))}
          </SelectInput>
        </Field>
        {picker ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFromDrive({ folders: purpose !== "knowledge", loginHint: email }).then((items) => (items.length ? save(items) : undefined)).catch((e: Error) => setError(e.message))}>
            Pick from Google Drive
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={picker ? "Or paste a Google Drive link" : "Paste a Google Drive link"} className="min-w-64 flex-1">
          <TextInput value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
        </Field>
        <Button type="button" variant="outline" disabled={busy || !driveIdFrom(link)} onClick={() => void save([{ id: driveIdFrom(link)!, name: "From Google Drive" }]).then(() => setLink(""))}>
          Add
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

type Kind = "calendar_sync" | "calendar_busy" | "business_location" | "ads_account" | "conversion_destination";
type ChoiceKind = "calendars" | "locations" | "ads_accounts" | "conversion_actions";

/** What Google offers to pick from, listed as soon as it opens. */
function ChooseFromList({ companyId, kind, title, empty, options }: { companyId: Id<"companies">; kind: ChoiceKind; title: string; empty: string; options: { kind: Kind; label: string }[] }) {
  const choices = useQuery(api.google.choices, { companyId, kind });
  const refresh = useMutation(api.google.refreshChoices);
  const add = useMutation(api.google.addResource);
  const { busy, error, run } = useRun();
  const [target, setTarget] = useState<Kind>(options[0].kind);
  const asked = useRef(false);
  useEffect(() => {
    if (choices === null && !asked.current) {
      asked.current = true;
      void refresh({ companyId, kind }).catch(() => undefined);
    }
  }, [choices, companyId, kind, refresh]);
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-strong">{title}</span>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => refresh({ companyId, kind }))}>
          Refresh
        </Button>
      </div>
      {options.length > 1 ? (
        <SelectInput aria-label="What to use it for" value={target} onChange={(e) => setTarget(e.target.value as Kind)}>
          {options.map((o) => (
            <option key={o.kind} value={o.kind}>
              {o.label}
            </option>
          ))}
        </SelectInput>
      ) : null}
      {!choices ? <p className="text-xs text-muted-foreground">Looking in your Google account…</p> : choices.problem ? <p className="text-xs text-muted-foreground">{choices.problem}</p> : choices.items.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : null}
      <ul className="grid gap-1">
        {(choices?.items ?? []).map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{item.label}</span>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => add({ companyId, kind: target, externalId: item.id, label: item.label, detail: kind === "locations" || kind === "conversion_actions" ? item.detail : undefined }))}>
              Use
            </Button>
          </li>
        ))}
      </ul>
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
    <Panel title="Your documents">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <ul className="grid gap-2">
          {(sources ?? []).map((s) => (
            <li key={s.resourceId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium text-strong">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.files.length ? s.files.map((f) => f.name).join(", ") : "Being read…"}</span>
              </span>
              {role === "owner" ? (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await read({ companyId, resourceId: s.resourceId }); setNote("Reading it again now."); })}>
                  Refresh
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
    <Panel title="Your calendar">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">Visits and interviews stay up to date on your calendar. If one is moved or deleted in Google, Selestial asks you before changing anything.</p>
        {(busyTimes ?? []).some((row) => row.problem) ? <p className="text-xs text-muted-foreground">One of your calendars couldn’t be read. Check it’s still shared with this Google account.</p> : null}
        {manager ? (
          <div>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { const r = await sync({ companyId }); setNote(r.repeated ? "Already updating." : "Updating your calendar now."); })}>
              Update now
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
    <Panel title="Your reviews" action={manager ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => syncNow({ companyId }))}>Check for new reviews</Button> : undefined}>
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
    <Panel title="Leads">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">New leads from your Google lead forms and Local Services Ads go straight to Sales. A returning customer is recognized, not added twice.</p>
        {owner ? (
          <div className="grid gap-2 rounded-lg border border-border p-3">
            <span className="text-sm text-strong">{leads.hasKey ? "Lead forms are set up." : "Connect your Google lead forms so leads arrive here."}</span>
            {shown ? (
              <div className="grid gap-1 text-sm">
                <span>In Google Ads, open your lead form, go to Lead delivery, and paste these two values:</span>
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">URL: {shown.webhookUrl}</code>
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">Key: {shown.key}</code>
                <span className="text-xs text-muted-foreground">Copy the key now. For your security it isn’t shown again.</span>
              </div>
            ) : null}
            <div>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => setShown(await rotate({ companyId })))}>
                {leads.hasKey ? "Set up again" : "Set up lead forms"}
              </Button>
            </div>
          </div>
        ) : null}
        <ul className="grid gap-1">
          {leads.leads.slice(0, 20).map((l) => (
            <li key={l._id} className="text-sm">
              {l.name ?? l.email ?? l.phone ?? "Lead"} <span className="text-xs text-muted-foreground">· {l.source === "local_services" ? "Local Services" : "Lead form"}{l.test ? " · test" : ""} · {new Date(l.receivedAt).toLocaleString()}</span>
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
                ${(d.dailyBudgetCents / 100).toFixed(2)} a day · {DRAFT_WORDS[d.state] ?? d.state} · {d.keywords.slice(0, 5).join(", ")}
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
    <Panel title="Booked-visit reporting">
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">When someone who clicked your ad books a visit, Google Ads is told, so your ads find more customers like them. It starts once you confirm your customers’ consent.</p>
        <p className="text-sm text-strong">{settings.consent ? "Reporting is on." : "Reporting is off."}</p>
        {owner ? (
          <div className="grid gap-2">
            <Field label="How your customers agreed to this">
              <TextArea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={userData} onCheckedChange={(checked) => setUserData(checked)} /> Customers agreed to share their data with Google for ads</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={personalization} onCheckedChange={(checked) => setPersonalization(checked)} /> Customers agreed to personalized ads</label>
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
              ${(c.valueCents / 100).toFixed(2)} · {REPORT_WORDS[c.status] ?? c.status}
              {c.reason ? ` · ${c.reason}` : ""}
            </li>
          ))}
        </ul>
        <FormError message={error} />
      </div>
    </Panel>
  );
}
