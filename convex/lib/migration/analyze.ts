/**
 * Checking a whole migration at once: every staged row against the other rows and against what the company
 * already has in Selestial. Pure: the caller loads the rows and records, and writes back what this returns.
 *
 * The rules, in short:
 *  - Nothing is merged on a shared name, email, phone or address alone. A match is shown with its reason
 *    and waits for the owner's choice.
 *  - A property, recurring service or booking is linked to a customer only when exactly one customer fits.
 *    When several could, it waits for the owner, listing them.
 *  - Ambiguous dates are not guessed: they're read in the order the files prove, or the owner chooses.
 *  - Required information that is missing stays missing, as a problem to fix. Nothing is invented.
 */
import { scheduleDates } from "../services/engine";
import type { Schedule } from "../services/spec";
import {
  addressComplete,
  endedStatus,
  IMPORTABLE,
  parseAvailability,
  parseEngagement,
  splitList,
  addressKey,
  cancelledStatus,
  CATEGORY_LABELS,
  completedStatus,
  customerNameOf,
  dateOrderOf,
  emailKey,
  firstEmail,
  firstPhone,
  nameKey,
  parseCents,
  parseDay,
  parseFrequency,
  parseMinutes,
  parseTime,
  pausedStatus,
  phoneKey,
  requiredProblems,
  SCHEDULE_WORDS,
  suggestCategory,
  type Category,
  type DateOrder,
  type FileKind,
} from "./rules";

export type RowIn = {
  id: string;
  kind: FileKind;
  index: number;
  /** Values with the owner's edits applied. */
  values: Record<string, string>;
  decision?: { choice: string; targetId?: string };
  /** The Selestial record this row already became or was matched to, after an import. */
  resultId?: string;
  category?: { value: Category; confirmed: boolean };
};

export type Existing = {
  customers: { id: string; name: string; email?: string; phone?: string }[];
  contacts: { customerId: string; email?: string; phone?: string }[];
  properties: { id: string; customerId: string; line1: string; line2?: string; postalCode: string; label?: string }[];
  plans: { propertyId: string; serviceId: string; state: string }[];
  /** Visits not cancelled, from today, by property and day. */
  jobs: { propertyId: string; day: string; serviceType: string }[];
  /** Records imported earlier from this source, by kind and the old system's id. */
  links: { kind: string; externalId: string; table: string; recordId: string }[];
  services: { id: string; name: string }[];
  /** The team already in Selestial, for spotting the same person twice. */
  cleaners?: { id: string; name: string; email?: string; phone?: string; windows?: { weekday: number; startMinute: number; endMinute: number }[] }[];
  /** History and opening balances already imported, so a repeat never counts them twice. */
  history?: { customerId: string; day: string; externalId?: string }[];
  balances?: { customerId: string; reference: string }[];
  /** Appointments and schedules the quick setup import brought in, still waiting or already set up. */
  quick?: { customerId: string; kind: "appointment" | "recurring"; day?: string }[];
};

export type Context = {
  today: string;
  dateOrder: DateOrder | null;
  serviceMap: { name: string; serviceId: string | null }[];
  groups: { key: string; accepted: boolean | null }[];
};

export type Match = { table: string; id: string; name: string; why: string };
export type RowOut = {
  id: string;
  state: "ready" | "update" | "duplicate" | "skip" | "error" | "review" | "held";
  problems: string[];
  notes: string[];
  matches: Match[];
  parent?: { rowId?: string; customerId?: string; propertyRowId?: string; propertyId?: string; planRowId?: string; planDate?: string };
  category?: { value: Category; because: string; confirmed: boolean };
  groupKey?: string;
  parsed: Record<string, string | number | boolean | null>;
  sourceId?: string;
};

export type Analysis = {
  rows: RowOut[];
  groups: { key: string; name: string; properties: number }[];
  /** Service names in the files, with how many rows use each. */
  serviceNames: { name: string; rows: number }[];
  dateOrder: { order: DateOrder | null; proof: string | null; ambiguous: number };
  notes: { key: string; step: "organize" | "review"; words: string; tone: "info" | "attention" | "done" }[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A day N days after a YYYY-MM-DD day. */
export function addDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The first day of a series on or after `from`, starting at `start`. */
export function rollForward(schedule: Schedule, start: string, from: string): string | null {
  if (start >= from) return start;
  const months = Math.min(36, Math.max(2, monthsApart(start, from) + 2));
  return scheduleDates(schedule, start, months).find((day) => day >= from) ?? null;
}

function monthsApart(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** The next few visits of a series from its first day, for the preview. */
export function nextVisits(schedule: Schedule, startsOn: string, count: number, endsOn?: string | null): string[] {
  return scheduleDates(schedule, startsOn, 4)
    .filter((day) => !endsOn || day < endsOn)
    .slice(0, count);
}

export function analyze(input: { rows: RowIn[]; existing: Existing; context: Context }): Analysis {
  const { rows, existing, context } = input;
  const out = new Map<string, RowOut>();
  const by = (kind: FileKind) => rows.filter((row) => row.kind === kind).sort((a, b) => a.index - b.index);
  const customers = by("customers");
  const properties = by("properties");
  const recurring = by("recurring");
  const bookings = by("bookings");
  const cleaners = by("cleaners");
  const history = by("history");
  const balances = by("balances");

  for (const row of rows) out.set(row.id, { id: row.id, state: "ready", problems: [], notes: [], matches: [], parsed: {}, ...(row.values.externalId ? { sourceId: row.values.externalId } : {}) });
  const get = (id: string) => out.get(id)!;
  const fail = (id: string, problem: string) => get(id).problems.push(problem);

  // ── Dates: how ambiguous ones are read, decided only by proof or by the owner ──
  const dateValues = [...recurring.flatMap((r) => [r.values.nextVisit, r.values.endDate]), ...bookings.map((b) => b.values.date)].filter((v): v is string => Boolean(v));
  const inferred = dateOrderOf(dateValues);
  const order = context.dateOrder ?? inferred.order;

  // ── Services: the old names, matched to Selestial services by the owner ──
  const serviceCounts = new Map<string, { name: string; rows: number }>();
  for (const row of [...recurring, ...bookings]) {
    const name = row.values.service?.trim();
    if (!name) continue;
    const key = nameKey(name);
    serviceCounts.set(key, { name: serviceCounts.get(key)?.name ?? name, rows: (serviceCounts.get(key)?.rows ?? 0) + 1 });
  }
  const serviceFor = (name: string): string | null | undefined => {
    const mapped = context.serviceMap.find((entry) => nameKey(entry.name) === nameKey(name));
    if (mapped) return mapped.serviceId;
    // An exact name match with a Selestial service is suggested as the match, still shown for the owner to confirm.
    return existing.services.find((service) => nameKey(service.name) === nameKey(name))?.id ?? undefined;
  };

  // ── Customers ──
  const linkFor = (kind: string, externalId: string | undefined) => (externalId ? existing.links.find((link) => link.kind === kind && link.externalId === externalId.trim()) : undefined);
  const existingName = new Map(existing.customers.map((c) => [c.id, c.name]));
  const customerRowOf = new Map<string, RowIn>();
  const businessKey = (row: RowIn) => {
    const company = row.values.company?.trim();
    const name = customerNameOf(row.values);
    const isBusiness = Boolean(company) || /\b(llc|inc|corp|ltd|company|group|dental|clinic|office|partners)\b/i.test(name);
    return isBusiness ? nameKey(company || name) : "";
  };

  // Commercial accounts: several rows for one business at different addresses.
  const groupRows = new Map<string, RowIn[]>();
  for (const row of customers) {
    const key = businessKey(row);
    if (!key) continue;
    groupRows.set(key, [...(groupRows.get(key) ?? []), row]);
  }
  const groups: Analysis["groups"] = [];
  const groupLeader = new Map<string, RowIn>();
  for (const [key, members] of groupRows) {
    const addresses = new Set(members.map((row) => addressKey(row.values)).filter(Boolean));
    if (members.length < 2 || addresses.size < 2) continue;
    groups.push({ key, name: members[0].values.company || customerNameOf(members[0].values), properties: addresses.size });
    groupLeader.set(key, members[0]);
  }
  const groupOf = (row: RowIn) => {
    const key = businessKey(row);
    return key && groupLeader.has(key) ? key : null;
  };
  const accepted = (key: string) => context.groups.find((group) => group.key === key)?.accepted ?? null;

  // Which customer rows have a recurring service, for the residential one-time / recurring split.
  const recurringFor = new Set<string>();

  const seenInFile = new Map<string, RowIn>();
  for (const row of customers) {
    const result = get(row.id);
    for (const problem of requiredProblems("customers", row.values)) fail(row.id, problem);
    const name = customerNameOf(row.values);
    const email = emailKey(firstEmail(row.values.email));
    const phone = phoneKey(firstPhone(row.values.phone));
    result.parsed = { name, email: email || null, phone: firstPhone(row.values.phone) ?? null, property: addressComplete(row.values) };
    customerRowOf.set(row.id, row);
    if (row.values.line1 && !addressComplete(row.values)) result.notes.push("The address is incomplete, so no property is added for this customer. Add the city, state and ZIP to include it.");

    const group = groupOf(row);
    if (group) {
      result.groupKey = group;
      const leader = groupLeader.get(group)!;
      if (leader.id !== row.id) {
        const decided = accepted(group);
        if (decided === true) {
          result.parent = { rowId: leader.id };
          result.notes.push(`Added as another property of ${customerNameOf(leader.values)}, a commercial account you grouped.`);
        } else if (decided === null) {
          result.state = "review";
          result.notes.push(`This file includes several properties for ${customerNameOf(leader.values)}. I've grouped them under one commercial account for your review.`);
        }
      }
    }

    const prior = linkFor("customers", row.values.externalId);
    if (prior) {
      result.state = "update";
      result.matches.push({ table: prior.table, id: prior.recordId, name: existingName.get(prior.recordId) ?? name, why: `Imported before with ID ${row.values.externalId}` });
      continue;
    }
    if (result.parent?.rowId) continue;

    const fileKey = `${nameKey(name)}|${email}|${phone}`;
    const earlier = seenInFile.get(fileKey);
    // Rows of one commercial account share a name on purpose; they are grouped above, not duplicates.
    if (earlier && nameKey(name) && !group) {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: earlier.id, name: customerNameOf(earlier.values), why: `Same name and contact details as row ${earlier.index + 2} of your file` });
    } else seenInFile.set(fileKey, row);

    const found = new Map<string, Match>();
    const note = (id: string, why: string) => {
      const prev = found.get(id);
      found.set(id, { table: "customers", id, name: existingName.get(id) ?? "A customer", why: prev ? `${prev.why} and ${why.toLowerCase()}` : why });
    };
    for (const customer of existing.customers) {
      if (email && emailKey(customer.email) === email) note(customer.id, "Same email");
      if (phone.length >= 10 && phoneKey(customer.phone) === phone) note(customer.id, "Same phone");
      if (nameKey(name).length >= 3 && nameKey(customer.name) === nameKey(name)) note(customer.id, "Same name");
    }
    for (const contact of existing.contacts) {
      if (email && emailKey(contact.email) === email && !found.has(contact.customerId)) note(contact.customerId, "Same email as one of their contacts");
      if (phone.length >= 10 && phoneKey(contact.phone) === phone && !found.has(contact.customerId)) note(contact.customerId, "Same phone as one of their contacts");
    }
    const key = addressKey(row.values);
    if (key) for (const property of existing.properties) if (addressKey({ line1: property.line1, line2: property.line2 ?? "", postalCode: property.postalCode }) === key) note(property.customerId, "Same service address");
    if (found.size) {
      result.matches.push(...[...found.values()].slice(0, 4));
      if (result.state === "ready") result.state = "duplicate";
      const onlyShared = [...found.values()].every((match) => !/name/i.test(match.why));
      if (onlyShared) result.notes.push("A shared email, phone or address can be a household member or a separate business. Choose whether this is the same customer.");
    }
  }

  // ── Finding the customer and property a row belongs to ──
  type CustomerRef = { rowId?: string; customerId?: string; label: string };
  const leaderOf = (rowId: string): string => {
    const row = customerRowOf.get(rowId);
    const group = row ? groupOf(row) : null;
    return group && accepted(group) === true ? groupLeader.get(group)!.id : rowId;
  };
  function resolveCustomer(row: RowIn): { ref: CustomerRef } | { problem: string; review?: Match[] } {
    const ref = row.values.customerRef?.trim();
    if (ref) {
      const fromFile = customers.find((c) => c.values.externalId?.trim() === ref);
      if (fromFile) return { ref: { rowId: leaderOf(fromFile.id), label: customerNameOf(fromFile.values) } };
      const prior = linkFor("customers", ref);
      if (prior) return { ref: { customerId: prior.recordId, label: existingName.get(prior.recordId) ?? ref } };
      if (!row.values.customerName) return { problem: `No customer with ID ${ref} is in your files or was imported before.` };
    }
    const wanted = nameKey(row.values.customerName);
    if (!wanted) return { problem: "It doesn't say which customer it's for." };
    const fileMatches = [...new Set(customers.filter((c) => nameKey(customerNameOf(c.values)) === wanted || (c.values.company && nameKey(c.values.company) === wanted)).map((c) => leaderOf(c.id)))];
    const existingMatches = existing.customers.filter((c) => nameKey(c.name) === wanted);
    const candidates: Match[] = [...fileMatches.map((id) => ({ table: "row", id, name: customerNameOf(customerRowOf.get(id)!.values), why: `Row ${customerRowOf.get(id)!.index + 2} of your customer file` })), ...existingMatches.map((c) => ({ table: "customers", id: c.id, name: c.name, why: "Already in Selestial" }))];
    // A file customer that is a match for the existing one is the same person: prefer the file row, which knows.
    if (fileMatches.length === 1) return { ref: { rowId: fileMatches[0], label: candidates[0].name } };
    if (fileMatches.length === 0 && existingMatches.length === 1) return { ref: { customerId: existingMatches[0].id, label: existingMatches[0].name } };
    if (!candidates.length) return { problem: `No customer named "${row.values.customerName}" is in your files or in Selestial.` };
    return { problem: `${plural(candidates.length, "customer")} named "${row.values.customerName}" could match. Choose which one.`, review: candidates };
  }

  /** The customer record a reference stands for: an existing one, or what a file row became or was matched to. */
  const recordOf = (ref: CustomerRef): string | undefined => {
    if (ref.customerId) return ref.customerId;
    const row = ref.rowId ? customerRowOf.get(ref.rowId) : undefined;
    return row?.resultId ?? (row?.decision?.choice === "keep_existing" ? row.decision.targetId : undefined);
  };

  type PropertyRef = { propertyRowId?: string; propertyId?: string; viaCustomerRow?: boolean; label: string };
  function resolveProperty(row: RowIn, customer: CustomerRef): { ref: PropertyRef } | { problem: string; review?: Match[] } {
    const ref = row.values.propertyRef?.trim();
    if (ref) {
      const fromFile = properties.find((p) => p.values.externalId?.trim() === ref);
      if (fromFile) return { ref: { propertyRowId: fromFile.id, label: fromFile.values.label || fromFile.values.line1 || ref } };
      const prior = linkFor("properties", ref);
      if (prior) return { ref: { propertyId: prior.recordId, label: ref } };
    }
    const wanted = addressKey(row.values);
    type Option = PropertyRef & { key: string };
    const options: Option[] = [];
    if (customer.rowId) {
      const members = customers.filter((c) => leaderOf(c.id) === customer.rowId && addressComplete(c.values));
      for (const member of members) options.push({ ...(member.id === customer.rowId ? { viaCustomerRow: true } : { propertyRowId: member.id }), key: addressKey(member.values), label: member.values.line1 });
      for (const p of properties) {
        const parent = get(p.id).parent;
        if (parent?.rowId === customer.rowId && addressComplete(p.values)) options.push({ propertyRowId: p.id, key: addressKey(p.values), label: p.values.label || p.values.line1 });
      }
    }
    if (customer.customerId) {
      for (const p of existing.properties.filter((p) => p.customerId === customer.customerId)) options.push({ propertyId: p.id, key: addressKey({ line1: p.line1, line2: p.line2 ?? "", postalCode: p.postalCode }), label: p.label || p.line1 });
      for (const p of properties) if (get(p.id).parent?.customerId === customer.customerId && addressComplete(p.values)) options.push({ propertyRowId: p.id, key: addressKey(p.values), label: p.values.label || p.values.line1 });
    }
    if (wanted) {
      const same = options.filter((option) => option.key === wanted);
      if (same.length >= 1) return { ref: same[0] };
      return { problem: `${customer.label} has no property at ${row.values.line1}. Add it to your properties file, or correct the address.` };
    }
    const distinct = [...new Map(options.map((o) => [o.key, o])).values()];
    if (distinct.length === 1) return { ref: distinct[0] };
    if (!distinct.length) return { problem: `${customer.label} has no service address in your files or in Selestial.` };
    return { problem: `${customer.label} has ${distinct.length} properties. Add the address or property ID to say which.`, review: distinct.map((o) => ({ table: o.propertyId ? "properties" : "row", id: o.propertyId ?? o.propertyRowId ?? customer.rowId ?? "", name: o.label, why: "One of this customer's properties" })) };
  }
  const propertyKey = (ref: PropertyRef, customer: CustomerRef) => ref.propertyId ?? ref.propertyRowId ?? `${customer.rowId ?? customer.customerId}:main`;

  // ── Properties ──
  const seenAddress = new Map<string, RowIn>();
  for (const row of properties) {
    const result = get(row.id);
    for (const problem of requiredProblems("properties", row.values)) fail(row.id, problem);
    const customer = resolveCustomer(row);
    if ("problem" in customer) {
      if (customer.review) {
        result.state = "review";
        result.matches.push(...customer.review);
        result.notes.push(customer.problem);
      } else fail(row.id, customer.problem);
    } else result.parent = customer.ref.rowId ? { rowId: customer.ref.rowId } : { customerId: customer.ref.customerId };
    const numbers: Record<string, number | null> = {};
    for (const key of ["bedrooms", "bathrooms", "squareFeet"]) {
      const raw = row.values[key];
      if (!raw) continue;
      const n = Number(raw.replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) result.notes.push(`"${raw}" isn't a number, so ${key === "squareFeet" ? "the square footage" : `the ${key}`} was left out.`);
      else numbers[key] = n;
    }
    result.parsed = numbers;
    const prior = linkFor("properties", row.values.externalId);
    if (prior) {
      result.state = "update";
      result.matches.push({ table: "properties", id: prior.recordId, name: row.values.label || row.values.line1 || "Property", why: `Imported before with ID ${row.values.externalId}` });
      continue;
    }
    const key = addressKey(row.values);
    if (!key) continue;
    const earlier = seenAddress.get(key);
    if (earlier) {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: earlier.id, name: earlier.values.line1, why: `Same address as row ${earlier.index + 2}` });
    } else seenAddress.set(key, row);
    // A customer row with this address already makes this property.
    const inline = customers.find((c) => addressKey(c.values) === key && (result.parent?.rowId ? leaderOf(c.id) === result.parent.rowId : false));
    if (inline && result.state === "ready") {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: inline.id, name: inline.values.line1, why: "The customer file already has this address for the same customer" });
    }
    for (const property of existing.properties) {
      if (addressKey({ line1: property.line1, line2: property.line2 ?? "", postalCode: property.postalCode }) !== key) continue;
      if (result.state === "ready") result.state = "duplicate";
      result.matches.push({ table: "properties", id: property.id, name: property.label || property.line1, why: `Same address as ${existingName.get(property.customerId) ?? "a customer"}'s property` });
    }
  }

  // ── Schedules: shared reading of dates, times and services ──
  function readDay(row: RowIn, field: string, label: string): string | null {
    const raw = row.values[field];
    if (!raw) return null;
    const read = parseDay(raw, order);
    if ("day" in read) return read.day;
    if ("ambiguous" in read) fail(row.id, `"${raw}" could be ${label === "date" ? "either of two dates" : `either of two ${label}s`}. Choose how your dates are written (month/day or day/month).`);
    else fail(row.id, read.error);
    return null;
  }
  function readService(row: RowIn): string | null {
    const name = row.values.service?.trim();
    if (!name) return null;
    if (!existing.services.length) {
      fail(row.id, "You have no live services yet. Publish your services in Services & Pricing, then match this one.");
      return null;
    }
    const id = serviceFor(name);
    if (id === null) {
      fail(row.id, `You chose not to import "${name}" visits.`);
      return null;
    }
    if (id === undefined) {
      fail(row.id, `Match "${name}" to one of your Selestial services.`);
      return null;
    }
    return id;
  }
  function placeOf(row: RowIn, result: RowOut): { customer: CustomerRef; property: PropertyRef } | null {
    const customer = resolveCustomer(row);
    if ("problem" in customer) {
      if (customer.review) {
        result.state = "review";
        result.matches.push(...customer.review);
        result.notes.push(customer.problem);
      } else fail(row.id, customer.problem);
      return null;
    }
    const property = resolveProperty(row, customer.ref);
    if ("problem" in property) {
      if (property.review) {
        result.state = "review";
        result.matches.push(...property.review);
        result.notes.push(property.problem);
      } else fail(row.id, property.problem);
      return null;
    }
    result.parent = {
      ...(customer.ref.rowId ? { rowId: customer.ref.rowId } : { customerId: customer.ref.customerId }),
      ...(property.ref.propertyRowId ? { propertyRowId: property.ref.propertyRowId } : property.ref.propertyId ? { propertyId: property.ref.propertyId } : {}),
    };
    return { customer: customer.ref, property: property.ref };
  }

  // ── Who did the work in the old system: matched to the team, never assigned ──
  type Window = { weekday: number; startMinute: number; endMinute: number };
  type CleanerMatch = { rowId?: string; cleanerId?: string; name: string; windows: Window[] | null; byFirstName: boolean };
  const teamRows = cleaners.filter((r) => !endedStatus(r.values.status) && r.decision?.choice !== "skip");
  function findCleaner(raw: string): CleanerMatch | { ambiguous: string[] } | null {
    const want = nameKey(raw);
    if (!want) return null;
    const pool: CleanerMatch[] = [
      ...teamRows.map((r) => ({ rowId: r.id, name: customerNameOf(r.values), windows: parseAvailability(r.values.availability), byFirstName: false })),
      ...(existing.cleaners ?? []).map((c) => ({ cleanerId: c.id, name: c.name, windows: c.windows ?? [], byFirstName: false })),
    ];
    const exact = pool.filter((c) => nameKey(c.name) === want);
    const pick = (list: CleanerMatch[], byFirstName: boolean) => {
      // The same person in the team file and already on the team counts once: the one already on the team.
      const distinct = [...new Map(list.map((c) => [nameKey(c.name), list.filter((x) => nameKey(x.name) === nameKey(c.name)).sort((a, b) => Number(Boolean(b.cleanerId)) - Number(Boolean(a.cleanerId)))[0]])).values()];
      if (distinct.length === 1) return { ...distinct[0], byFirstName };
      return distinct.length > 1 ? { ambiguous: distinct.map((c) => c.name) } : null;
    };
    const found = pick(exact, false);
    if (found) return found;
    if (want.includes(" ")) return null;
    return pick(pool.filter((c) => nameKey(c.name).split(" ")[0] === want), true);
  }
  const fmt = (m: number) => `${Math.floor(m / 60) % 12 || 12}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}${m < 720 ? "am" : "pm"}`;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
  /** Notes about the old system's cleaner for one visit or series, and the preferred cleaner to keep. */
  function assignment(row: RowIn, result: RowOut, day: string | null, time: string | null, minutes: number | null, what: "visit" | "series") {
    const raw = row.values.cleaner?.trim();
    if (!raw) return null;
    const match = findCleaner(raw);
    if (!match) {
      result.notes.push(`${raw} did this work in your old system, but no one by that name is on your team or in your team file. It comes over without a preferred cleaner.`);
      return null;
    }
    if ("ambiguous" in match) {
      result.notes.push(`Several people could be "${raw}" (${match.ambiguous.join(", ")}). Write the full name to keep one as the preferred cleaner.`);
      return null;
    }
    result.notes.push(`${match.name}${match.byFirstName ? ` (matched from "${raw}")` : ""} is kept as the preferred cleaner: once released, Dispatch offers ${what === "visit" ? "this visit" : "these visits"} to them first if they're eligible. Nothing is assigned.`);
    if (day && time) {
      const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      const end = start + (minutes ?? 120);
      const weekday = weekdayOf(day);
      if (match.windows === null) result.notes.push(`${match.name}'s availability in your team file couldn't be read, so this wasn't checked against it.`);
      else if (!match.windows.length) result.notes.push(`${match.name} has no weekly availability on file yet, so Dispatch can't offer them work until they set it.`);
      else if (!match.windows.some((w) => w.weekday === weekday && w.startMinute <= start && w.endMinute >= end)) {
        result.notes.push(`This is outside ${match.name}'s availability: ${WEEKDAYS[weekday]} ${fmt(start)}–${fmt(end)} isn't in their weekly hours. Dispatch will offer it to someone else unless their hours change.`);
        result.parsed.assignmentIssue = true;
      }
    }
    return match;
  }

  // ── Recurring services ──
  type Series = { rowId: string; place: string; serviceId: string; schedule: Schedule; startsOn: string; days: Set<string>; sourceId?: string; claimed: Set<string> };
  const series: Series[] = [];
  const seenSeries = new Map<string, RowIn>();
  for (const row of recurring) {
    const result = get(row.id);
    for (const problem of requiredProblems("recurring", row.values)) fail(row.id, problem);
    const place = placeOf(row, result);
    if (place?.customer.rowId) recurringFor.add(place.customer.rowId);
    const serviceId = readService(row);
    const frequency = row.values.frequency ? parseFrequency(row.values.frequency) : null;
    if (frequency && "error" in frequency) fail(row.id, frequency.error);
    else if (frequency?.note) result.notes.push(frequency.note);
    const next = readDay(row, "nextVisit", "date");
    const ends = readDay(row, "endDate", "date");
    const time = row.values.time ? parseTime(row.values.time) : null;
    if (row.values.time && !time) fail(row.id, `"${row.values.time}" isn't a time Selestial can read, like 9:00 AM.`);
    if (!row.values.time) fail(row.id, "Add a start time for these visits.");
    const minutes = row.values.durationMinutes ? parseMinutes(row.values.durationMinutes) : null;
    if (row.values.durationMinutes && minutes === null) result.notes.push(`"${row.values.durationMinutes}" isn't a length Selestial can read, so the service's own length is used.`);
    const price = row.values.price ? parseCents(row.values.price) : { cents: null };
    if ("error" in price) fail(row.id, price.error);
    const paused = pausedStatus(row.values.status);
    if (ends && ends < context.today) {
      result.state = "skip";
      result.notes.push(`This recurring service ended on ${ends}, so it isn't brought over as an active plan.`);
      continue;
    }
    if (frequency && "schedule" in frequency && next) {
      const startsOn = rollForward(frequency.schedule, next, context.today);
      if (!startsOn) fail(row.id, "Selestial couldn't work out the next visit from this schedule.");
      else {
        if (startsOn !== next) result.notes.push(`The next visit in your file (${next}) has passed, so the series continues from ${startsOn}, keeping the same ${SCHEDULE_WORDS[frequency.schedule].toLowerCase()} rhythm.`);
        const preview = nextVisits(frequency.schedule, startsOn, 4, ends);
        result.parsed = { schedule: frequency.schedule, startsOn, endsOn: ends, time, minutes, cents: "cents" in price ? price.cents : null, paused, serviceId, preview: preview.join(",") };
        if (place && serviceId) {
          const placeKey = propertyKey(place.property, place.customer);
          const twin = seenSeries.get(`${placeKey}|${serviceId}`);
          if (twin) {
            result.state = "duplicate";
            result.matches.push({ table: "row", id: twin.id, name: twin.values.service ?? "Recurring service", why: `The same service at the same property as row ${twin.index + 2}` });
          } else seenSeries.set(`${placeKey}|${serviceId}`, row);
          const knownCustomer = recordOf(place.customer);
          if (knownCustomer && (existing.quick ?? []).some((q) => q.kind === "recurring" && q.customerId === knownCustomer)) {
            if (result.state === "ready") result.state = "duplicate";
            result.matches.push({ table: "migrationRecords", id: knownCustomer, name: row.values.service ?? "Recurring service", why: "The quick import in setup already brought in a recurring service for this client" });
          }
          if (place.property.propertyId && existing.plans.some((plan) => plan.propertyId === place.property.propertyId && plan.serviceId === serviceId && plan.state !== "ended")) {
            if (result.state === "ready") result.state = "duplicate";
            result.matches.push({ table: "servicePlans", id: place.property.propertyId, name: row.values.service ?? "Plan", why: "This property already has this service planned in Selestial" });
          }
          series.push({ rowId: row.id, place: placeKey, serviceId, schedule: frequency.schedule, startsOn, days: new Set(scheduleDates(frequency.schedule, startsOn, 6)), ...(row.values.externalId ? { sourceId: row.values.externalId } : {}), claimed: new Set() });
        }
      }
    }
    if ("cents" in price && price.cents !== null) result.notes.push(`The price in your file (${(price.cents / 100).toFixed(2)}) is proposed as this property's own price. Nothing is charged at it until you approve it in Services & Pricing.`);
    if (!row.values.price) result.notes.push("No price is in your file, so visits are priced by your Services & Pricing.");
    if (paused) result.notes.push(`It's marked "${row.values.status}" in your old system, so it's brought over paused.`);
    {
      const startsOn = typeof result.parsed.startsOn === "string" ? result.parsed.startsOn : null;
      const match = assignment(row, result, startsOn, time, minutes, "series");
      if (match?.rowId) result.parsed.cleanerRowId = match.rowId;
      if (match?.cleanerId) result.parsed.cleanerId = match.cleanerId;
    }
  }

  // ── Upcoming bookings ──
  const seenVisit = new Map<string, RowIn>();
  const booked: { row: RowIn; who: string; name: string; day: string; start: number; end: number }[] = [];
  for (const row of bookings) {
    const result = get(row.id);
    if (cancelledStatus(row.values.status)) {
      result.state = "skip";
      result.notes.push(`It's marked "${row.values.status}", so it isn't brought over.`);
      continue;
    }
    for (const problem of requiredProblems("bookings", row.values)) fail(row.id, problem);
    const day = readDay(row, "date", "date");
    if (day && (day < context.today || completedStatus(row.values.status))) {
      result.state = "skip";
      result.notes.push(`This visit was on ${day}${completedStatus(row.values.status) ? ` and is marked "${row.values.status}"` : ""}. Past visits are service history, which is brought over in a later step.`);
      continue;
    }
    const place = placeOf(row, result);
    const serviceId = readService(row);
    const time = row.values.time ? parseTime(row.values.time) : null;
    if (row.values.time && !time) fail(row.id, `"${row.values.time}" isn't a time Selestial can read, like 9:00 AM.`);
    if (!row.values.time) fail(row.id, "Add a start time for this visit.");
    const end = row.values.endTime ? parseTime(row.values.endTime) : null;
    const minutes = row.values.durationMinutes ? parseMinutes(row.values.durationMinutes) : null;
    let length: number | null = minutes;
    if (time && end) {
      const diff = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
      if (diff >= 15) length = diff;
      else result.notes.push(`The end time ${row.values.endTime} isn't after the start, so the service's own length is used.`);
    }
    if (length === null) result.notes.push("No length is in your file, so the service's own length is used.");
    const price = row.values.price ? parseCents(row.values.price) : { cents: null };
    if ("error" in price) fail(row.id, price.error);
    if (!row.values.price) result.notes.push("No price is in your file. None is added: Selestial prices it from your Services & Pricing when you release your schedule.");
    result.parsed = { day, time, minutes: length, cents: "cents" in price ? price.cents : null, serviceId };
    {
      const match = assignment(row, result, day, time, length, "visit");
      if (match?.rowId) result.parsed.cleanerRowId = match.rowId;
      if (match?.cleanerId) result.parsed.cleanerId = match.cleanerId;
      if (match && day && time) {
        const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
        booked.push({ row, who: match.cleanerId ?? match.rowId!, name: match.name, day, start, end: start + (length ?? 120) });
      }
    }
    if (!place || !day) continue;
    const placeKey = propertyKey(place.property, place.customer);

    // One visit per property, day and time in the file, and none already on the Selestial schedule.
    const visitKey = `${placeKey}|${day}|${time ?? ""}`;
    const twin = seenVisit.get(visitKey);
    if (twin) {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: twin.id, name: twin.values.service ?? "Visit", why: `The same property, day and time as row ${twin.index + 2}` });
    } else seenVisit.set(visitKey, row);
    if (place.property.propertyId) {
      const booked = existing.jobs.find((job) => job.propertyId === place.property.propertyId && job.day === day);
      if (booked) {
        if (result.state === "ready") result.state = "duplicate";
        result.matches.push({ table: "jobs", id: place.property.propertyId, name: booked.serviceType, why: `A visit is already on your Selestial schedule at this property on ${day}` });
      }
    }

    const knownCustomer = recordOf(place.customer);
    if (knownCustomer && (existing.quick ?? []).some((q) => q.kind === "appointment" && q.customerId === knownCustomer && q.day === day)) {
      if (result.state === "ready") result.state = "duplicate";
      result.matches.push({ table: "migrationRecords", id: knownCustomer, name: row.values.service ?? "Appointment", why: `The quick import in setup already brought in an appointment for this client on ${day}` });
    }
    // A visit of an imported recurring service: the plan won't book that day again.
    const byRef = row.values.recurringRef ? series.find((s) => s.sourceId === row.values.recurringRef?.trim()) : undefined;
    const candidates = byRef ? [byRef] : series.filter((s) => s.place === placeKey && (!serviceId || s.serviceId === serviceId));
    for (const s of candidates) {
      let planDate: string | null = s.days.has(day) ? day : null;
      if (!planDate) for (let shift = 1; shift <= 3 && !planDate; shift += 1) planDate = [addDay(day, -shift), addDay(day, shift)].find((d) => s.days.has(d)) ?? null;
      if (!planDate) {
        if (byRef) result.notes.push(`It names recurring service ${row.values.recurringRef}, but ${day} isn't near one of its visits. It's brought over as a separate visit.`);
        continue;
      }
      if (s.claimed.has(planDate)) {
        if (result.state === "ready") result.state = "duplicate";
        result.matches.push({ table: "row", id: s.rowId, name: "Recurring visit", why: `Another booking already stands for this recurring service's visit on ${planDate}` });
        break;
      }
      s.claimed.add(planDate);
      result.parent = { ...result.parent, planRowId: s.rowId, planDate };
      result.notes.push(planDate === day ? `A visit of the recurring service. The plan won't book ${day} a second time.` : `A moved visit of the recurring service: it stands for the ${planDate} visit, so the plan won't book that day too.`);
      break;
    }
  }

  // Double-bookings: the same preferred cleaner on two visits that overlap.
  let doubleBooked = 0;
  for (const a of booked) {
    const clash = booked.find((b) => b !== a && b.who === a.who && b.day === a.day && b.start < a.end && a.start < b.end);
    if (!clash) continue;
    get(a.row.id).notes.push(`${a.name} is also down for row ${clash.row.index + 2} at the same time on ${a.day}. Both visits come over; Dispatch offers the second to someone else if they can't do both.`);
    get(a.row.id).parsed.assignmentIssue = true;
    doubleBooked += 1;
  }

  // ── Cleaners ──
  const seenPerson = new Map<string, RowIn>();
  for (const row of cleaners) {
    const result = get(row.id);
    for (const problem of requiredProblems("cleaners", row.values)) if (!/employee or a contractor/.test(problem)) fail(row.id, problem);
    const name = customerNameOf(row.values);
    const engagement = parseEngagement(row.values.engagement);
    if ("error" in engagement) fail(row.id, engagement.error);
    else if (engagement.engagement === "subcontractor") result.notes.push("A subcontractor worker needs their subcontractor company. It's added as a contractor if no company is named; change it on their profile.");
    const availability = parseAvailability(row.values.availability);
    if (availability === null) result.notes.push(`Selestial couldn't read the availability "${row.values.availability}", so none was set. They can confirm their hours when they're onboarded.`);
    const areas = splitList(row.values.serviceAreas).filter((a) => /^[0-9a-z -]{3,10}$/i.test(a));
    result.parsed = { name, engagement: "engagement" in engagement ? engagement.engagement : null, availability: availability ? JSON.stringify(availability) : null, skills: splitList(row.values.skills).join("|"), areas: areas.join("|") };
    if (endedStatus(row.values.status)) {
      result.state = "skip";
      result.notes.push(`Marked "${row.values.status}" in your old system, so they're not added. Choose to import anyway if they still work with you.`);
      continue;
    }
    result.notes.push(`Added as onboarding${row.values.status ? ` (they were "${row.values.status}" in your old system)` : ""}. No invitation or message is sent, and they aren't offered work until you make them active and their requirements are met.`);
    const prior = linkFor("cleaners", row.values.externalId);
    if (prior) {
      result.state = "update";
      result.matches.push({ table: prior.table, id: prior.recordId, name, why: `Imported before with ID ${row.values.externalId}` });
      continue;
    }
    const email = emailKey(firstEmail(row.values.email));
    const phone = phoneKey(firstPhone(row.values.phone));
    const key = `${nameKey(name)}|${email}|${phone}`;
    const earlier = seenPerson.get(key);
    if (earlier && nameKey(name)) {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: earlier.id, name: customerNameOf(earlier.values), why: `Same person as row ${earlier.index + 2}` });
    } else seenPerson.set(key, row);
    for (const person of existing.cleaners ?? []) {
      const why = email && emailKey(person.email) === email ? "Same email" : phone.length >= 10 && phoneKey(person.phone) === phone ? "Same phone" : nameKey(person.name) === nameKey(name) ? "Same name" : null;
      if (!why) continue;
      if (result.state === "ready") result.state = "duplicate";
      result.matches.push({ table: "cleaners", id: person.id, name: person.name, why: `${why} as someone already on your team` });
    }
  }

  // ── Service history: read-only, never a job ──
  const seenVisitBefore = new Map<string, RowIn>();
  for (const row of history) {
    const result = get(row.id);
    for (const problem of requiredProblems("history", row.values)) fail(row.id, problem);
    const day = readDay(row, "date", "date");
    if (day && day > context.today) {
      result.state = "skip";
      result.notes.push(`This visit is on ${day}, which hasn't happened yet. Put upcoming visits in your bookings file instead.`);
      continue;
    }
    const price = row.values.price ? parseCents(row.values.price) : { cents: null };
    if ("error" in price) result.notes.push(`${price.error} The price is left out of this history entry.`);
    result.parsed = { day, cents: "cents" in price ? price.cents : null };
    const customer = resolveCustomer(row);
    if ("problem" in customer) {
      if (customer.review) {
        result.state = "review";
        result.matches.push(...customer.review);
        result.notes.push(customer.problem);
      } else fail(row.id, customer.problem);
      continue;
    }
    result.parent = customer.ref.rowId ? { rowId: customer.ref.rowId } : { customerId: customer.ref.customerId };
    const property = resolveProperty(row, customer.ref);
    if ("ref" in property) {
      if (property.ref.propertyRowId) result.parent.propertyRowId = property.ref.propertyRowId;
      if (property.ref.propertyId) result.parent.propertyId = property.ref.propertyId;
    } else if (row.values.line1 || row.values.propertyRef) result.notes.push(`${property.problem} The visit is kept on the client without a property.`);
    result.notes.push("Kept as read-only history on the client. It isn't a job, so it's never paid, invoiced, reviewed or followed up.");
    const owner = customer.ref.rowId ?? customer.ref.customerId!;
    const key = `${owner}|${day}|${nameKey(row.values.service)}|${row.values.externalId ?? ""}`;
    const twin = seenVisitBefore.get(key);
    if (twin) {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: twin.id, name: twin.values.service ?? "Visit", why: `The same visit as row ${twin.index + 2}` });
    } else seenVisitBefore.set(key, row);
    if (customer.ref.customerId && (existing.history ?? []).some((h) => h.customerId === customer.ref.customerId && h.day === day && (!row.values.externalId || h.externalId === row.values.externalId))) {
      if (result.state === "ready") result.state = "duplicate";
      result.matches.push({ table: "importedHistory", id: customer.ref.customerId, name: row.values.service ?? "Visit", why: `This client already has imported history on ${day}` });
    }
  }

  // ── Opening balances: reference only ──
  const seenInvoice = new Map<string, RowIn>();
  const owed = new Map<string, { label: string; rows: number; cents: number }>();
  for (const row of balances) {
    const result = get(row.id);
    for (const problem of requiredProblems("balances", row.values)) fail(row.id, problem);
    const amount = row.values.amount ? parseCents(row.values.amount.replace(/^\((.*)\)$/, "-$1")) : { cents: null };
    if ("error" in amount) fail(row.id, /negative/.test(amount.error) ? "A credit (negative balance) isn't imported. Record credits in Finance." : amount.error);
    else if (amount.cents === 0) {
      result.state = "skip";
      result.notes.push("Nothing is owed on this invoice, so there's no balance to bring over.");
      continue;
    }
    const issued = readDay(row, "issued", "date");
    const due = readDay(row, "due", "date");
    result.parsed = { cents: "cents" in amount ? amount.cents : null, issued, due };
    const customer = resolveCustomer(row);
    if ("problem" in customer) {
      if (customer.review) {
        result.state = "review";
        result.matches.push(...customer.review);
        result.notes.push(customer.problem);
      } else fail(row.id, customer.problem);
      continue;
    }
    result.parent = customer.ref.rowId ? { rowId: customer.ref.rowId } : { customerId: customer.ref.customerId };
    result.notes.push("Kept as an opening balance for reference, with its old invoice number. It's never charged, reminded or added to Selestial invoices.");
    const owner = customer.ref.rowId ?? customer.ref.customerId!;
    const ref = (row.values.externalId ?? "").trim().toLowerCase();
    const twin = ref ? seenInvoice.get(`${owner}|${ref}`) : undefined;
    if (twin) {
      result.state = "duplicate";
      result.matches.push({ table: "row", id: twin.id, name: twin.values.externalId ?? "Invoice", why: `The same invoice number as row ${twin.index + 2}` });
    } else if (ref) seenInvoice.set(`${owner}|${ref}`, row);
    if (customer.ref.customerId && ref && (existing.balances ?? []).some((b) => b.customerId === customer.ref.customerId && b.reference.trim().toLowerCase() === ref)) {
      if (result.state === "ready") result.state = "duplicate";
      result.matches.push({ table: "openingBalances", id: customer.ref.customerId, name: row.values.externalId ?? "Invoice", why: "This invoice was already brought over as an opening balance" });
    }
    if ("cents" in amount && amount.cents && result.state !== "duplicate" && row.decision?.choice !== "skip") {
      const sum = owed.get(owner) ?? { label: customer.ref.label, rows: 0, cents: 0 };
      owed.set(owner, { ...sum, rows: sum.rows + 1, cents: sum.cents + amount.cents });
    }
  }

  // ── Customer categories, now that schedules are known ──
  for (const row of customers) {
    const result = get(row.id);
    if (row.category?.confirmed) {
      result.category = { value: row.category.value, because: "You chose it.", confirmed: true };
      continue;
    }
    const suggested = suggestCategory(row.values, recurringFor.has(row.id) || (result.parent?.rowId ? recurringFor.has(result.parent.rowId) : false));
    result.category = { value: suggested.category, because: suggested.because, confirmed: false };
  }

  // ── Rows not imported yet ──
  for (const row of rows) {
    if ((IMPORTABLE as readonly string[]).includes(row.kind)) continue;
    const result = get(row.id);
    result.state = "held";
    result.notes.push(row.kind === "agreements" ? "Kept with your migration. Upload the signed documents themselves in Agreements: Selestial never treats an agreement as signed without your verification." : "Kept with your migration. Selestial doesn't import this kind of record yet, so nothing was created from it.");
  }

  // ── Final state: problems win; a decision settles a choice ──
  for (const row of rows) {
    const result = get(row.id);
    if (result.state === "held" || result.state === "skip") continue;
    if (result.problems.length) result.state = "error";
    if (row.decision?.choice === "skip") result.state = "skip";
  }

  // ── Notes for the assistant panel ──
  const notes: Analysis["notes"] = [];
  const count = (state: RowOut["state"]) => [...out.values()].filter((r) => r.state === state).length;
  if (order && !context.dateOrder && inferred.proof) notes.push({ key: "dates", step: "organize", words: `Dates are read as ${order === "mdy" ? "month/day" : "day/month"}/year, because "${inferred.proof}" can only be read that way.`, tone: "info" });
  if (!order && inferred.ambiguous) notes.push({ key: "dates", step: "organize", words: `${plural(inferred.ambiguous, "date")} like 03/04/2027 could be read two ways. Choose how your files write dates.`, tone: "attention" });
  for (const group of groups) if (accepted(group.key) === null) notes.push({ key: `group:${group.key}`, step: "review", words: `This file includes ${group.properties} properties for ${group.name}. I've grouped them under one commercial account for your review.`, tone: "attention" });
  const unmatched = [...serviceCounts.values()].filter((s) => serviceFor(s.name) === undefined);
  if (unmatched.length) notes.push({ key: "services", step: "organize", words: `${plural(unmatched.length, "service name")} in your files ${unmatched.length === 1 ? "needs" : "need"} matching to your Selestial services: ${unmatched.slice(0, 3).map((s) => `"${s.name}"`).join(", ")}${unmatched.length > 3 ? "…" : ""}.`, tone: "attention" });
  const dups = count("duplicate");
  if (dups) notes.push({ key: "duplicates", step: "review", words: `${plural(dups, "record")} may already exist. Nothing is merged until you choose.`, tone: "attention" });
  const errors = count("error");
  if (errors) notes.push({ key: "errors", step: "review", words: `${plural(errors, "record")} ${errors === 1 ? "has" : "have"} missing or unreadable information. Fix them here, or skip them.`, tone: "attention" });
  const linked = bookings.filter((row) => get(row.id).parent?.planRowId).length;
  if (linked) notes.push({ key: "reconcile", step: "review", words: `${plural(linked, "upcoming booking")} ${linked === 1 ? "is a visit" : "are visits"} of your recurring services. Each is brought over once, and the plan won't book the same day again.`, tone: "done" });
  const assignmentIssues = [...out.values()].filter((r) => r.parsed.assignmentIssue).length;
  if (assignmentIssues) notes.push({ key: "assignments", step: "review", words: `${plural(assignmentIssues, "visit")} ${assignmentIssues === 1 ? "has" : "have"} a cleaner conflict from your old system${doubleBooked ? ` (${doubleBooked} double-booked)` : ""}, such as a time outside their availability. Nothing is assigned, so nothing breaks; Dispatch offers those visits to someone free.`, tone: "attention" });
  const several = [...owed.values()].filter((o) => o.rows > 1);
  if (several.length) notes.push({ key: "balances", step: "review", words: `${plural(several.length, "customer")} ${several.length === 1 ? "has" : "have"} more than one balance row (${several.slice(0, 2).map((o) => `${o.label}: ${o.rows} rows, $${(o.cents / 100).toFixed(2)}`).join("; ")}). Check they're separate invoices, not a running total, so nothing is counted twice.`, tone: "attention" });
  const categories = new Map<Category, number>();
  for (const row of customers) {
    const c = get(row.id).category;
    if (c) categories.set(c.value, (categories.get(c.value) ?? 0) + 1);
  }
  if (categories.size) notes.push({ key: "categories", step: "review", words: `Customer types I suggested: ${[...categories.entries()].map(([c, n]) => `${n} ${CATEGORY_LABELS[c].toLowerCase()}`).join(", ")}. Each shows why; change any that are wrong.`, tone: "info" });

  return { rows: [...out.values()], groups, serviceNames: [...serviceCounts.values()].sort((a, b) => b.rows - a.rows), dateOrder: { order, proof: inferred.proof, ambiguous: inferred.ambiguous }, notes };
}
