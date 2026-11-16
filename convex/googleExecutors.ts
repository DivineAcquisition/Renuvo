/**
 * What each kind of Google job does. Each executor is told whether this run is a reconcile (an earlier
 * attempt's answer was lost): a write then first looks for its own effect by key and only acts if it is
 * not there. An executor returns what it did; the worker records it on the job.
 */
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Executor } from "./googleWork";
import { campaignByName, createPausedCampaign, customerId, localServicesLeads, performance, setCampaignStatus } from "./lib/google/ads";
import { getReview, reply, reviewParent, reviews as listReviews, starsOf } from "./lib/google/business";
import { deleteEvent, draftHash, upsertEvent } from "./lib/google/calendar";
import { ingest } from "./lib/google/datamanager";
import { findByKey, FOLDER, getFile, GOOGLE_DOC, GOOGLE_SHEET, listChildren, markdownToHtml, readText, toCsv, upload } from "./lib/google/drive";
import { GoogleError } from "./lib/google/http";
import { adsDeveloperToken } from "./lib/google/platform";

const need = (token: string | null): string => {
  if (!token) throw new GoogleError("auth", "No Google access for this job.");
  return token;
};
const str = (value: unknown, what: string): string => {
  if (typeof value !== "string" || !value) throw new GoogleError("invalid", `The job is missing ${what}.`);
  return value;
};
const developer = (): string => {
  const value = adsDeveloperToken();
  if (!value) throw new GoogleError("not_configured", "GOOGLE_ADS_DEVELOPER_TOKEN is not set on this deployment.");
  return value;
};
const enc = (text: string) => new TextEncoder().encode(text);

/** A file that was already made by an earlier attempt of the same job. */
async function existing(token: string, key: string) {
  const file = await findByKey(token, key);
  return file && !file.trashed ? file : null;
}

const driveUpload: Executor = async (ctx, { job, token, payload }) => {
  const t = need(token);
  const found = await existing(t, job.key);
  if (found) return { result: { fileId: found.id, webViewLink: found.webViewLink }, providerRef: found.id };
  const folder = await ctx.runQuery(internal.google.resourceFor, { resourceId: str(payload.resourceId, "a folder") as Id<"googleResources"> });
  if (!folder || folder.access === "lost") return { outcome: "failed", error: "The folder is no longer authorized." };
  const blob = await ctx.storage.get(str(payload.storageId, "a file") as Id<"_storage">);
  if (!blob) return { outcome: "failed", error: "The file is no longer stored in Selestial." };
  const file = await upload(t, { name: str(payload.name, "a name"), parentId: folder.externalId, key: job.key, mimeType: str(payload.mimeType, "a type"), bytes: new Uint8Array(await blob.arrayBuffer()) });
  return { result: { fileId: file.id, webViewLink: file.webViewLink }, providerRef: file.id };
};

const docExport: Executor = async (ctx, { job, token, payload }) => {
  const t = need(token);
  const found = await existing(t, job.key);
  if (found) return { result: { fileId: found.id, webViewLink: found.webViewLink }, providerRef: found.id };
  const folder = await ctx.runQuery(internal.google.resourceFor, { resourceId: str(payload.resourceId, "a folder") as Id<"googleResources"> });
  if (!folder || folder.access === "lost") return { outcome: "failed", error: "The agreements folder is no longer authorized." };
  const agreement = await ctx.runQuery(internal.googleDrive.agreementText, { agreementId: str(payload.agreementId, "an agreement") as Id<"agreements">, version: Number(payload.version) });
  if (!agreement) return { outcome: "failed", error: "That agreement version no longer exists." };
  // A copy to read and share. The header says so, and nothing about the agreement's state changes.
  const header = `# ${agreement.title}\n\nVersion ${payload.version} · exported from Selestial · fingerprint ${agreement.hash.slice(0, 16)}\n\nThis is a copy for reading. It is not a signature and does not change the agreement's status in Selestial.`;
  const file = await upload(t, { name: `${agreement.title} (v${payload.version})`, parentId: folder.externalId, key: job.key, mimeType: "text/html", as: GOOGLE_DOC, bytes: enc(markdownToHtml(`${header}\n\n${agreement.markdown}`)), description: "Exported from Selestial. Not a signature." });
  await ctx.runMutation(internal.googleDrive.exported, { companyId: job.companyId, agreementId: payload.agreementId as Id<"agreements">, version: Number(payload.version), link: file.webViewLink ?? "" });
  return { result: { fileId: file.id, webViewLink: file.webViewLink }, providerRef: file.id };
};

const sheetExport: Executor = async (ctx, { job, token, payload }) => {
  const t = need(token);
  const found = await existing(t, job.key);
  if (found) return { result: { fileId: found.id, webViewLink: found.webViewLink }, providerRef: found.id };
  const folder = await ctx.runQuery(internal.google.resourceFor, { resourceId: str(payload.resourceId, "a folder") as Id<"googleResources"> });
  if (!folder || folder.access === "lost") return { outcome: "failed", error: "The reports folder is no longer authorized." };
  const rows = Array.isArray(payload.rows) ? (payload.rows as (string | number)[][]) : [];
  const file = await upload(t, { name: str(payload.title, "a title"), parentId: folder.externalId, key: job.key, mimeType: "text/csv", as: GOOGLE_SHEET, bytes: enc(toCsv(rows)) });
  return { result: { fileId: file.id, webViewLink: file.webViewLink, rows: rows.length }, providerRef: file.id };
};

const knowledgeImport: Executor = async (ctx, { job, token, payload }) => {
  const t = need(token);
  const resource = await ctx.runQuery(internal.google.resourceFor, { resourceId: str(payload.resourceId, "a source") as Id<"googleResources"> });
  if (!resource || resource.kind !== "drive_source") return { outcome: "cancelled", error: "The source is no longer chosen." };
  const root = await getFile(t, resource.externalId);
  const files = root.mimeType === FOLDER ? (await listChildren(t, root.id)).filter((f) => f.mimeType !== FOLDER).slice(0, 25) : [root];
  const out: { fileId: string; name: string; text: string }[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const text = await readText(t, file).catch(() => null);
    if (text && text.trim()) out.push({ fileId: file.id, name: file.name, text });
    else skipped.push(file.name);
  }
  await ctx.runMutation(internal.googleDrive.storeTexts, { companyId: job.companyId, resourceId: resource._id, files: out, proposeBy: job.requestedBy });
  await ctx.runMutation(internal.google.setResourceAccess, { resourceId: resource._id, access: "verified", note: `${out.length} file${out.length === 1 ? "" : "s"} read${skipped.length ? `; ${skipped.length} could not be read as text` : ""}.` });
  return { result: { read: out.map((f) => f.name), skipped } };
};

const calendarSync: Executor = async (ctx, { job, token }) => {
  const t = need(token);
  const plan = await ctx.runQuery(internal.googleCalendar.plan, { companyId: job.companyId });
  if (!plan) return { outcome: "cancelled", error: "No calendar is chosen for visits and interviews." };
  const links = new Map(plan.links.map((l) => [l.eventId, l]));
  let written = 0;
  let held = 0;
  for (const draft of plan.desired) {
    const link = links.get(draft.id);
    const { subject, ...event } = draft;
    const hash = draftHash(event);
    if (link?.externalChange) {
      held += 1; // A person decides first; Selestial does not overwrite a change someone made in Google.
      continue;
    }
    if (link && link.writtenHash === hash) continue;
    await upsertEvent(t, plan.calendarId, event);
    await ctx.runMutation(internal.googleCalendar.saveLink, { companyId: job.companyId, calendarId: plan.calendarId, subject, eventId: draft.id, writtenHash: hash });
    written += 1;
  }
  let removed = 0;
  for (const eventId of plan.stale) {
    await deleteEvent(t, plan.calendarId, eventId);
    await ctx.runMutation(internal.googleCalendar.dropLink, { companyId: job.companyId, eventId });
    removed += 1;
  }
  return { result: { written, removed, held, total: plan.desired.length } };
};

const reviewReply: Executor = async (ctx, { token, payload, reconcile }) => {
  const t = need(token);
  const review = await ctx.runQuery(internal.googleBusiness.forReply, { reviewId: str(payload.reviewId, "a review") as Id<"googleReviews"> });
  if (!review || review.state !== "publishing" || !review.approvedText) return { outcome: "cancelled", error: "The reply is no longer approved for publishing." };
  const live = await getReview(t, review.reviewName);
  if (!live) {
    await ctx.runMutation(internal.googleBusiness.replyResult, { reviewId: review._id, ok: false, problem: "The review was removed from Google." });
    return { outcome: "cancelled", error: "The review was removed from Google." };
  }
  // A reply that already says exactly what was approved means an earlier attempt worked.
  if ((reconcile || live.reviewReply) && live.reviewReply?.comment?.trim() === review.approvedText.trim()) {
    await ctx.runMutation(internal.googleBusiness.replyResult, { reviewId: review._id, ok: true });
    return { result: { published: true, reconciled: true } };
  }
  await reply(t, review.reviewName, review.approvedText);
  await ctx.runMutation(internal.googleBusiness.replyResult, { reviewId: review._id, ok: true });
  return { result: { published: true } };
};

const reviewsSync: Executor = async (ctx, { job, token }) => {
  const t = need(token);
  const locations = await ctx.runQuery(internal.googleBusiness.locationsFor, { companyId: job.companyId });
  let seen = 0;
  for (const location of locations) {
    const rows = await listReviews(t, reviewParent(location.account, location.name));
    await ctx.runMutation(internal.googleBusiness.storeReviews, {
      companyId: job.companyId,
      location: location.name,
      reviews: rows.slice(0, 200).map((r) => ({ reviewName: r.name, reviewer: r.reviewer?.isAnonymous ? "A Google user" : (r.reviewer?.displayName ?? "A Google user"), stars: starsOf(r.starRating), comment: r.comment?.slice(0, 4000), createdAt: Date.parse(r.createTime ?? "") || Date.now(), existingReply: r.reviewReply?.comment?.slice(0, 4000) })),
    });
    seen += rows.length;
  }
  return { result: { locations: locations.length, reviews: seen } };
};

const adsCampaign: Executor = async (ctx, { token, payload }) => {
  const t = need(token);
  const dev = developer();
  const draft = await ctx.runQuery(internal.googleAds.draftFor, { draftId: str(payload.draftId, "a draft") as Id<"googleAdDrafts"> });
  if (!draft || draft.state !== "approved" || draft.approvedBudgetCents !== draft.dailyBudgetCents) return { outcome: "cancelled", error: "The campaign is no longer approved as drafted." };
  const login = draft.loginCustomerId ?? undefined;
  // Never two campaigns for one draft: look it up by its unique name first.
  const already = await campaignByName(t, dev, draft.accountId, draft.name, login);
  const resourceName = already?.resourceName ?? (await createPausedCampaign(t, dev, draft.accountId, { name: draft.name, dailyBudgetMicros: draft.dailyBudgetCents * 10_000 }, login));
  await ctx.runMutation(internal.googleAds.campaignCreated, { draftId: draft._id, resourceName });
  return { result: { campaign: resourceName, status: "PAUSED" }, providerRef: resourceName };
};

const adsActivate: Executor = async (ctx, { token, payload }) => {
  const t = need(token);
  const dev = developer();
  const draft = await ctx.runQuery(internal.googleAds.draftFor, { draftId: str(payload.draftId, "a draft") as Id<"googleAdDrafts"> });
  if (!draft || draft.state !== "created_paused" || !draft.googleCampaign || !draft.activatedBy) return { outcome: "cancelled", error: "Turning this campaign on is no longer authorized." };
  const login = draft.loginCustomerId ?? undefined;
  const live = await campaignByName(t, dev, draft.accountId, draft.name, login);
  if (!live) return { outcome: "failed", error: "The campaign is not in Google Ads any more." };
  if (live.status !== "ENABLED") await setCampaignStatus(t, dev, draft.accountId, live.resourceName, "ENABLED", login);
  await ctx.runMutation(internal.googleAds.campaignActivated, { draftId: draft._id });
  return { result: { campaign: live.resourceName, status: "ENABLED" }, providerRef: live.resourceName };
};

const adsSnapshot: Executor = async (ctx, { job, token, payload }) => {
  const t = need(token);
  const account = str(payload.accountId, "an ad account");
  const rows = await performance(t, developer(), account, typeof payload.loginCustomerId === "string" ? payload.loginCustomerId : undefined);
  await ctx.runMutation(internal.googleAds.storeSnapshot, { companyId: job.companyId, accountId: customerId(account), rows: rows.slice(0, 200) });
  return { result: { campaigns: rows.length } };
};

const lsaPoll: Executor = async (ctx, { job, token, payload }) => {
  const t = need(token);
  const account = str(payload.accountId, "an ad account");
  const since = typeof payload.since === "string" ? payload.since : new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const leads = await localServicesLeads(t, developer(), account, since, typeof payload.loginCustomerId === "string" ? payload.loginCustomerId : undefined);
  let added = 0;
  for (const lead of leads.slice(0, 200)) {
    const outcome = await ctx.runMutation(internal.googleAds.ingestLead, { companyId: job.companyId, source: "local_services", externalId: lead.id, name: lead.name, phone: lead.phone, email: lead.email, campaign: lead.type });
    if (outcome.created) added += 1;
  }
  return { result: { seen: leads.length, added } };
};

const conversion: Executor = async (ctx, { token, payload, reconcile }) => {
  const t = need(token);
  const plan = await ctx.runQuery(internal.googleAds.conversionPlan, { conversionId: str(payload.conversionId, "a conversion") as Id<"googleConversions"> });
  if (!plan.ok) {
    await ctx.runMutation(internal.googleAds.conversionResult, { conversionId: payload.conversionId as Id<"googleConversions">, status: "skipped", reason: plan.why });
    return { outcome: "cancelled", error: plan.why };
  }
  // Data Manager dedupes on the transaction id, so sending again after a lost answer does not count twice.
  const answer = await ingest(t, plan.destination, [plan.event]);
  await ctx.runMutation(internal.googleAds.conversionResult, { conversionId: plan.conversionId, status: "sent", diagnostics: JSON.stringify({ requestId: answer.requestId, reconciled: reconcile }) });
  return { result: { requestId: answer.requestId }, providerRef: answer.requestId ?? undefined };
};

const routeProposal: Executor = async (ctx, { job, payload }) => {
  const proposal = await ctx.runAction(internal.googleRoutes.propose, { companyId: job.companyId, day: str(payload.day, "a day") });
  return proposal.ok ? { result: proposal } : { outcome: "failed", error: proposal.why };
};

const travelRefresh: Executor = async (ctx, { job }) => {
  await ctx.runAction(internal.googleRoutes.refreshTravel, { companyId: job.companyId });
  return {};
};

const busyRefresh: Executor = async (ctx, { job }) => {
  await ctx.runAction(internal.googleCalendar.refreshBusy, { companyId: job.companyId });
  return {};
};

const calendarWatch: Executor = async (ctx, { job }) => {
  await ctx.runAction(internal.googleCalendar.ensureWatch, { companyId: job.companyId });
  return {};
};

const businessWatch: Executor = async (ctx, { job }) => {
  await ctx.runAction(internal.googleBusiness.ensureNotifications, { companyId: job.companyId });
  return {};
};

const gmailWatch: Executor = async (ctx, { payload }) => {
  await ctx.runAction(internal.recruiterGmailWatch.ensure, { connectionId: str(payload.mailboxId, "a mailbox") as Id<"mailboxConnections"> });
  return {};
};

export const EXECUTORS: Record<Doc<"googleJobs">["kind"], Executor> = {
  drive_upload: driveUpload,
  doc_export: docExport,
  sheet_export: sheetExport,
  knowledge_import: knowledgeImport,
  calendar_sync: calendarSync,
  calendar_event: calendarSync,
  busy_refresh: busyRefresh,
  calendar_watch: calendarWatch,
  review_reply: reviewReply,
  reviews_sync: reviewsSync,
  business_watch: businessWatch,
  ads_campaign: adsCampaign,
  ads_activate: adsActivate,
  ads_snapshot: adsSnapshot,
  lsa_poll: lsaPoll,
  conversion,
  gmail_watch: gmailWatch,
  route_proposal: routeProposal,
  travel_refresh: travelRefresh,
};
