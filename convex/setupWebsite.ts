/**
 * Reading the owner's own website during setup (lib/setup/website.ts holds the rules).
 *
 * The Owner starts a read; a background action reads up to ten pages of that one site, recording each page
 * as it goes, then the rules (and the model, when available) suggest facts. Suggestions are saved as found,
 * never as confirmed; the owner confirms them in setup. The first completed read is free and is the only
 * one offered in setup; a read that failed or was stopped does not count.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { companyQuery, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { foundFact, stateFact } from "./lib/setup/facts";
import { extract, isPrivateAddress, MAX_PAGE_BYTES, MAX_PAGES, MAX_REDIRECTS, normalizeSite, PAGE_TIMEOUT_MS, pickLinks, readPage, sameSite, type Extraction, type Page } from "./lib/setup/website";
import { readWithModel } from "./lib/setup/websiteModel";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher | null = null;

/** Tests only: every request the reader makes goes here instead of the network. */
export function setWebsiteFetchForTests(next: Fetcher | null) {
  fetcher = next;
}
const go: Fetcher = (url, init) => (fetcher ?? fetch)(url, init);

async function latest(ctx: { db: import("./_generated/server").QueryCtx["db"] }, companyId: Id<"companies">) {
  return ctx.db
    .query("websiteReads")
    .withIndex("by_company_started", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
}

/** The latest read of the company's website, as the setup screen shows it. */
export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const row = await latest(ctx, ctx.companyId);
    if (!row) return null;
    return { readId: row._id, host: row.host, status: row.status, pages: row.pages, services: row.services, found: row.found, reader: row.reader, free: row.free, problem: row.problem ?? null, startedAt: row.startedAt, finishedAt: row.finishedAt ?? null };
  },
});

/** Starts reading the owner's site. Asking again while a read runs, or after one finished, finds it. */
export const start = ownerMutation({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const site = normalizeSite(args.url);
    if (!site.ok) throw userError(site.words);
    const previous = await latest(ctx, ctx.companyId);
    if (previous && (previous.status === "queued" || previous.status === "reading")) return { readId: previous._id, already: true };
    if (previous && previous.status === "ready") {
      if (sameSite(previous.host, site.host)) return { readId: previous._id, already: true };
      throw userError("Your website was already read once during setup. Correct the details by hand; reading another site isn't offered here yet.");
    }
    // The address the owner typed is theirs to state.
    await stateFact(ctx, ctx.companyId, ctx.member._id, "company.website", site.host);
    const readId = await ctx.db.insert("websiteReads", { companyId: ctx.companyId, host: site.host, status: "queued", pages: [], services: [], found: 0, reader: "rules", free: true, requestedBy: ctx.member._id, startedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.setupWebsite.run, { readId });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "setup.website_read_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { host: site.host } });
    return { readId, already: false };
  },
});

/** Stops a read between pages. What was already read is kept. */
export const stop = ownerMutation({
  args: { readId: v.id("websiteReads") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.readId);
    if (!row || row.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (row.status === "queued" || row.status === "reading") await ctx.db.patch(row._id, { status: "stopped", finishedAt: Date.now(), problem: "Stopped by you." });
    return null;
  },
});

export const context = internalQuery({
  args: { readId: v.id("websiteReads") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.readId);
    return row ? { host: row.host, status: row.status } : null;
  },
});

/** Records one page as read, unless the read was stopped. Returns whether to go on. */
export const page = internalMutation({
  args: { readId: v.id("websiteReads"), url: v.string(), title: v.string(), ok: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.readId);
    if (!row || (row.status !== "queued" && row.status !== "reading")) return false;
    await ctx.db.patch(row._id, { status: "reading", pages: [...row.pages, { url: args.url, title: args.title.slice(0, 200), ok: args.ok, ...(args.note ? { note: args.note } : {}), at: Date.now() }] });
    return true;
  },
});

const findingValidator = v.object({ key: v.string(), value: v.union(v.string(), v.array(v.string())), sourceRef: v.string() });
const serviceValidator = v.object({ name: v.string(), category: v.union(v.string(), v.null()), advertised: v.union(v.string(), v.null()), sourceRef: v.string() });

/** Saves what the read found: facts as found suggestions, services as the pages named them. */
export const finish = internalMutation({
  args: { readId: v.id("websiteReads"), ok: v.boolean(), problem: v.optional(v.string()), findings: v.array(findingValidator), services: v.array(serviceValidator), reader: v.union(v.literal("rules"), v.literal("rules_and_model")) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.readId);
    if (!row || (row.status !== "queued" && row.status !== "reading")) return null;
    let found = 0;
    if (args.ok) {
      for (const finding of args.findings) {
        const result = await foundFact(ctx, row.companyId, finding.key as Parameters<typeof foundFact>[2], finding.value, "website", finding.sourceRef);
        if (result !== "same") found += 1;
      }
    }
    await ctx.db.patch(row._id, { status: args.ok ? "ready" : "failed", services: args.ok ? args.services : [], found, reader: args.reader, ...(args.problem ? { problem: args.problem } : {}), finishedAt: Date.now() });
    await recordEvent(ctx, { companyId: row.companyId, type: args.ok ? "setup.website_read" : "setup.website_read_failed", actor: { kind: "system" }, subject: { table: "companies", id: row.companyId }, data: { host: row.host, pages: row.pages.filter((p) => p.ok).length, found } });
    return null;
  },
});

/** Whether every address a name resolves to is public. A name that resolves nowhere is not read. */
async function publicHost(host: string): Promise<{ ok: true } | { ok: false; words: string }> {
  const answers: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try {
      const response = await go(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const body = (await response.json()) as { Answer?: { type: number; data: string }[] };
      for (const answer of body.Answer ?? []) if (answer.type === 1 || answer.type === 28) answers.push(answer.data);
    } catch {
      // Treated as no answer.
    }
  }
  if (answers.length === 0) return { ok: false, words: "We couldn't find that website. Check the address." };
  if (answers.some(isPrivateAddress)) return { ok: false, words: "That address doesn't point to a public website, so it wasn't read." };
  return { ok: true };
}

async function body(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

/** Fetches one page of the site, following redirects only within it. */
async function fetchPage(host: string, url: URL): Promise<{ ok: true; url: string; html: string } | { ok: false; note: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!sameSite(host, current.hostname) || (current.protocol !== "https:" && current.protocol !== "http:")) return { ok: false, note: "It led to another website, which was not read." };
    const check = await publicHost(current.hostname);
    if (!check.ok) return { ok: false, note: check.words };
    let response: Response;
    try {
      response = await go(current.toString(), { redirect: "manual", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "SelestialSetup/1.0 (reads a company's own site at its owner's request)" }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    } catch {
      return { ok: false, note: "The page didn't answer in time." };
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return { ok: false, note: "The page pointed nowhere." };
      current = new URL(next, current);
      continue;
    }
    if (!response.ok) return { ok: false, note: `The page answered ${response.status}.` };
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/.test(type)) return { ok: false, note: "It isn't a web page." };
    const html = await body(response);
    if (html === null) return { ok: false, note: "The page was empty." };
    return { ok: true, url: current.toString(), html };
  }
  return { ok: false, note: "It redirected too many times." };
}

function merge(rules: Extraction, model: Extraction | null): Extraction {
  if (!model) return rules;
  const findings = [...rules.findings];
  for (const finding of model.findings) if (!findings.some((row) => row.key === finding.key)) findings.push(finding);
  const services = [...rules.services];
  for (const service of model.services) if (!services.some((row) => row.name.toLowerCase() === service.name.toLowerCase())) services.push(service);
  return { findings, services: services.slice(0, 12) };
}

export const run = internalAction({
  args: { readId: v.id("websiteReads") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.setupWebsite.context, { readId: args.readId });
    if (!job || job.status !== "queued") return null;
    const fail = (problem: string) => ctx.runMutation(internal.setupWebsite.finish, { readId: args.readId, ok: false, problem, findings: [], services: [], reader: "rules" });
    const home = await fetchPage(job.host, new URL(`https://${job.host}/`));
    if (!home.ok) {
      await ctx.runMutation(internal.setupWebsite.page, { readId: args.readId, url: `https://${job.host}/`, title: "Home page", ok: false, note: home.note });
      await fail(`We couldn't read your home page: ${home.note} You can enter your details yourself.`);
      return null;
    }
    const pages: Page[] = [readPage(home.url, home.html)];
    if (!(await ctx.runMutation(internal.setupWebsite.page, { readId: args.readId, url: home.url, title: pages[0].title || "Home page", ok: true }))) return null;
    for (const url of pickLinks(new URL(home.url), pages[0].links, MAX_PAGES - 1)) {
      const result = await fetchPage(job.host, url);
      const page = result.ok ? readPage(result.url, result.html) : null;
      if (page) pages.push(page);
      const goOn = await ctx.runMutation(internal.setupWebsite.page, { readId: args.readId, url: url.toString(), title: page?.title || url.pathname, ok: Boolean(page), ...(result.ok ? {} : { note: result.note }) });
      if (!goOn) return null;
    }
    const rules = extract(pages, job.host);
    const model = await readWithModel(pages);
    const merged = merge(rules, model);
    await ctx.runMutation(internal.setupWebsite.finish, { readId: args.readId, ok: true, findings: merged.findings, services: merged.services, reader: model ? "rules_and_model" : "rules" });
    return null;
  },
});
