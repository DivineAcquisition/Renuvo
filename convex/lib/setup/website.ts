/**
 * Reading an owner's own website during setup: which addresses may be read, which pages, and what can be
 * taken from them. Pure, so every rule is tested without a network.
 *
 * A page is data, never instructions: nothing on it changes what is read or done, and everything taken
 * from it is a suggestion the owner confirms. Marketing words are not facts about the business: an
 * advertised "from $120" is kept as advertised text and never becomes a price.
 */

export const MAX_PAGES = 10;
export const MAX_PAGE_BYTES = 1_500_000;
export const MAX_TEXT_PER_PAGE = 12_000;
export const PAGE_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".private", ".test", ".invalid", ".example", ".arpa"];

export type SiteCheck = { ok: true; url: URL; host: string } | { ok: false; words: string };

/** The site the owner gave, as an address Selestial may read, or why not. */
export function normalizeSite(input: string): SiteCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, words: "Enter your website address." };
  if (raw.length > 200) return { ok: false, words: "That address is too long." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, words: "That doesn't look like a website address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, words: "Use an address that starts with https://." };
  if (url.username || url.password) return { ok: false, words: "Leave any username or password out of the address." };
  if (url.port && url.port !== "443" && url.port !== "80") return { ok: false, words: "Use the address people visit, without a port number." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpLiteral(host)) return { ok: false, words: "Use your website's name, not a numeric address." };
  if (!host.includes(".") || BLOCKED_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) return { ok: false, words: "That isn't a public website address." };
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((label) => label === "" || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return { ok: false, words: "That doesn't look like a website address." };
  return { ok: true, url: new URL(`https://${host}/`), host };
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || /^\[.*\]$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host);
}

/** Whether an address a name resolves to is private, local or reserved. Any such answer stops the read. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (ip.includes(":")) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip) || ip.startsWith("2001:db8") || ip.startsWith("64:ff9b");
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

/** The same site: the host itself, or it with or without "www.". Anything else is not read. */
export function sameSite(host: string, candidate: string): boolean {
  const bare = (value: string) => value.toLowerCase().replace(/^www\./, "");
  return bare(host) === bare(candidate);
}

const USEFUL = ["service", "pricing", "price", "rates", "cost", "about", "contact", "area", "location", "where-we", "faq", "polic", "terms", "cancel", "guarantee", "book", "residential", "house", "home", "commercial", "office", "janitorial", "airbnb", "vacation", "rental", "move", "deep", "window", "carpet", "construction"];
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|mp4|mov|mp3|woff2?|ttf)(\?|#|$)/i;

/** Up to `limit` links on the same site worth reading, most useful first. Login, cart and account pages are left out. */
export function pickLinks(base: URL, hrefs: string[], limit = MAX_PAGES - 1): URL[] {
  const seen = new Set<string>([base.pathname.replace(/\/$/, "") || "/"]);
  const scored: { url: URL; score: number }[] = [];
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (!sameSite(base.hostname, url.hostname) || SKIP.test(url.pathname)) continue;
    const path = url.pathname.toLowerCase().replace(/\/$/, "") || "/";
    if (/(login|log-in|signin|sign-in|account|cart|checkout|wp-admin|admin|feed|tag\/|author\/|page\/\d)/.test(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const score = USEFUL.reduce((sum, word) => sum + (path.includes(word) ? 1 : 0), 0) - path.split("/").length * 0.1;
    if (score > 0) scored.push({ url: new URL(`https://${base.hostname}${url.pathname}`), score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((row) => row.url);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export type Page = { url: string; title: string; description: string; headings: string[]; text: string; links: string[]; tel: string[]; mailto: string[]; jsonLd: unknown[] };

/** What a page says, as plain text and the few structured parts worth having. Scripts, styles and hidden data are dropped. */
export function readPage(url: string, html: string): Page {
  const jsonLd: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      jsonLd.push(JSON.parse(match[1]));
    } catch {
      // A broken block is ignored.
    }
  }
  const attr = (pattern: RegExp) => [...html.matchAll(pattern)].map((match) => decode(match[1]).trim()).filter(Boolean);
  const links = attr(/<a\b[^>]*\bhref=["']([^"'#][^"']*)["']/gi);
  const tel = links.filter((href) => href.toLowerCase().startsWith("tel:")).map((href) => href.slice(4).replace(/[^\d+]/g, ""));
  const mailto = links.filter((href) => href.toLowerCase().startsWith("mailto:")).map((href) => href.slice(7).split("?")[0].toLowerCase());
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ");
  const headings = [...stripped.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => clean(match[1])).filter((h) => h.length > 1 && h.length < 140).slice(0, 60);
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200);
  const description = clean(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ?? "").slice(0, 400);
  const text = clean(stripped.replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).slice(0, MAX_TEXT_PER_PAGE);
  return { url, title, description, headings, text, links, tel, mailto, jsonLd };
}

function clean(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " "))
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ── What can be taken from the pages ────────────────────────────────────────────────────────────

export type Finding = { key: "company.location" | "company.areas" | "contact.phone" | "contact.email" | "company.about" | "policies.published" | "services.categories"; value: string | string[]; sourceRef: string };
export type FoundService = { name: string; category: string | null; advertised: string | null; sourceRef: string };
export type Extraction = { findings: Finding[]; services: FoundService[] };

const CATEGORY_WORDS: Record<string, string[]> = {
  residential: ["house cleaning", "home cleaning", "residential", "maid service", "deep clean", "move-out", "move out", "move-in", "recurring cleaning"],
  commercial: ["office cleaning", "commercial cleaning", "janitorial", "commercial", "business cleaning", "retail cleaning"],
  short_term_rental: ["airbnb", "vacation rental", "short-term rental", "short term rental", "vrbo", "turnover"],
  property_management: ["property manager", "property management", "apartment turn", "make-ready", "make ready"],
  post_construction: ["post-construction", "post construction", "construction clean", "builder clean"],
  specialty: ["window cleaning", "carpet cleaning", "upholstery", "pressure washing", "floor care", "grout"],
};

function flatJsonLd(items: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      out.push(value as Record<string, unknown>);
      const graph = (value as Record<string, unknown>)["@graph"];
      if (graph) visit(graph);
    }
  };
  visit(items);
  return out;
}
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

function formatPhone(digits: string): string | null {
  const d = digits.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{9}$/.test(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}

/**
 * Facts the pages state plainly: structured business data first, then contact links, then wording.
 * Nothing is inferred about prices, pay, licences, insurance, capacity or who owns the business.
 */
export function extract(pages: Page[], host: string): Extraction {
  const findings: Finding[] = [];
  const add = (finding: Finding) => {
    if (!findings.some((row) => row.key === finding.key)) findings.push(finding);
  };
  const business = pages.flatMap((page) => flatJsonLd(page.jsonLd).map((item) => ({ item, url: page.url }))).filter(({ item }) => /business|service|organization|cleaning|housepainter|homeandconstruction/i.test(JSON.stringify(item["@type"] ?? "")));
  for (const { item, url } of business) {
    const address = item.address as Record<string, unknown> | undefined;
    const city = str(address?.addressLocality);
    const region = str(address?.addressRegion);
    if (city) add({ key: "company.location", value: region ? `${city}, ${region}` : city, sourceRef: url });
    const phone = formatPhone(str(item.telephone));
    if (phone) add({ key: "contact.phone", value: phone, sourceRef: url });
    const email = str(item.email).replace(/^mailto:/i, "").toLowerCase();
    if (EMAIL.test(email)) add({ key: "contact.email", value: email, sourceRef: url });
    const served = ([] as unknown[]).concat(item.areaServed ?? []).map((area) => (typeof area === "string" ? area : str((area as Record<string, unknown>)?.name))).filter(Boolean);
    if (served.length) add({ key: "company.areas", value: served.slice(0, 20).join(", ").slice(0, 300), sourceRef: url });
  }
  for (const page of pages) {
    const tel = page.tel.map(formatPhone).find(Boolean);
    if (tel) add({ key: "contact.phone", value: tel, sourceRef: page.url });
    const own = page.mailto.find((address) => EMAIL.test(address) && (address.endsWith(`@${host.replace(/^www\./, "")}`) || /@(gmail|outlook|hotmail|yahoo|icloud|aol)\.com$/.test(address)));
    if (own) add({ key: "contact.email", value: own, sourceRef: page.url });
  }
  for (const page of pages) {
    const match = page.text.match(PHONE);
    if (match) add({ key: "contact.phone", value: formatPhone(match[0])!, sourceRef: page.url });
  }
  // Areas in plain words: "serving Austin, Round Rock and Cedar Park".
  for (const page of pages) {
    // Names only, on one line: "and" and "&" join them; a period, a line break or lower-case words end the list.
    const served = page.text.match(/\b(?:proudly[ \t]+)?(?:serving|serve|service areas?:?|we clean in|areas we serve:?)[ \t]+((?:[A-Z][\w'-]*(?:[ \t][A-Z][\w'-]*)*(?:,[ \t]*|[ \t]+and[ \t]+|[ \t]*&[ \t]*)){0,15}[A-Z][\w'-]*(?:[ \t][A-Z][\w'-]*)*)/);
    if (served && served[1].length > 3 && served[1] === served[1].replace(/[A-Z]{4,}/g, "")) add({ key: "company.areas", value: served[1].replace(/[ \t]+and[ \t]+|[ \t]*&[ \t]*/g, ", ").slice(0, 300), sourceRef: page.url });
  }
  const home = pages[0];
  if (home?.description && home.description.length > 30) add({ key: "company.about", value: home.description.slice(0, 300), sourceRef: home.url });

  // Who they clean for, from words on the pages.
  const all = pages.map((page) => `${page.title}\n${page.headings.join("\n")}\n${page.text}`.toLowerCase());
  const categories = Object.entries(CATEGORY_WORDS)
    .map(([category, words]) => ({ category, hits: words.reduce((sum, word) => sum + all.reduce((n, text) => n + (text.includes(word) ? 1 : 0), 0), 0) }))
    .filter((row) => row.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((row) => row.category);
  if (categories.length) add({ key: "services.categories", value: categories, sourceRef: home?.url ?? `https://${host}/` });

  // A published policy, as the page's own sentence, never paraphrased into a rule.
  for (const page of pages) {
    const sentence = page.text.split(/(?<=[.!?])\s+|\n/).find((line) => /cancel|reschedul|guarantee|re-clean|satisfaction/i.test(line) && line.length > 30 && line.length < 300);
    if (sentence) {
      add({ key: "policies.published", value: sentence.trim(), sourceRef: page.url });
      break;
    }
  }

  // Services: headings that name a kind of cleaning, with any advertised price nearby kept as text.
  const services: FoundService[] = [];
  for (const page of pages) {
    for (const heading of page.headings) {
      const lower = heading.toLowerCase();
      if (!/clean|turnover|janitorial|maid|wash|carpet|window|move[- ]?(in|out)/.test(lower) || lower.length > 60 || /why|how|what|who|faq|testimonial|review|contact|about|blog|call|book now|get a quote|our team/.test(lower)) continue;
      if (services.some((row) => row.name.toLowerCase() === lower)) continue;
      // Only this service's own section: up to the next heading, never into the next service's price.
      const at = page.text.indexOf(heading);
      const ends = page.headings.map((other) => (other === heading ? -1 : page.text.indexOf(other, at + heading.length))).filter((index) => index > at);
      const near = at >= 0 ? page.text.slice(at, Math.min(at + 400, ...ends)) : "";
      const price = near.match(/(?:from|starting at|starts at|as low as)?\s*\$\s?\d{2,4}(?:\.\d{2})?(?:\s*(?:\/|per)\s*(?:hour|hr|visit|clean|room))?/i);
      const category = Object.entries(CATEGORY_WORDS).find(([, words]) => words.some((word) => lower.includes(word.split(" ")[0])))?.[0] ?? null;
      services.push({ name: heading.slice(0, 60), category, advertised: price ? price[0].trim() : null, sourceRef: page.url });
      if (services.length >= 12) break;
    }
  }
  return { findings, services };
}
