/**
 * Building a document from its clauses and answers, and checking the answers deterministically. A model
 * never writes the legal text here: the clause library does, and a person (or a model, through a tool)
 * only supplies facts. A fact nobody gave becomes [[TO CONFIRM: ...]]; nothing is invented.
 */
import { CLAUSE_BY_KEY, type Clause, type ClauseFlag } from "./clauses";
import { docType, type DocType } from "./catalog";
import { sha256 } from "./hash";
import { formatTerm, isAnswered, VARIABLE_BY_KEY, type Terms, type TermValue, type VarDef } from "./variables";

const truthy = (value: TermValue | undefined) => isAnswered(value) && value !== false && value !== 0 && value !== "No";

/** True when a clause applies given what has been answered. A gate that is not answered yet leaves the clause out. */
export function clauseApplies(clause: Clause, terms: Terms): boolean {
  if (clause.when !== undefined) return truthy(terms[clause.when]);
  if (clause.unless !== undefined) return isAnswered(terms[clause.unless]) && !truthy(terms[clause.unless]);
  return true;
}

/**
 * The clauses and custom fields one agreement is built from. A copy is saved on the agreement when it is
 * made, so later edits to a template or to Selestial's library never change it.
 */
export type Kit = { clauses: readonly Clause[]; extra?: readonly VarDef[] };

export function kitFor(type: DocType): Kit {
  return { clauses: type.clauses.map((key) => CLAUSE_BY_KEY.get(key)).filter((found): found is Clause => Boolean(found)) };
}

export function defOf(kit: Kit | undefined, key: string): VarDef | undefined {
  return kit?.extra?.find((def) => def.key === key) ?? VARIABLE_BY_KEY.get(key);
}

export type Part = { key: string; version: number; title: string; text: string; flags: readonly ClauseFlag[] };

export type Rendered = {
  title: string;
  markdown: string;
  /** Every clause used, with the version it had. Saved on the agreement version. */
  clauses: { key: string; version: number }[];
  parts: Part[];
  /** What is still to confirm, in the order it appears. */
  unresolved: string[];
};

const placeholder = (label: string) => `[[TO CONFIRM: ${label}]]`;

function fill(body: string, terms: Terms, kit: Kit): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const def = defOf(kit, key);
    const value = terms[key];
    if (!def) return placeholder(key);
    return isAnswered(value) ? formatTerm(def, value) : placeholder(def.label);
  });
}

/** The words of one document, built only from the type's clauses and the answers given. */
export function render(type: DocType, terms: Terms, options: { kit?: Kit; titleOverride?: string } = {}): Rendered {
  const kit = options.kit ?? kitFor(type);
  const parts: Part[] = [];
  for (const found of kit.clauses) {
    if (!clauseApplies(found, terms)) continue;
    parts.push({ key: found.key, version: found.version, title: found.title, text: fill(found.body, terms, kit), flags: found.flags ?? [] });
  }
  const title = options.titleOverride ?? type.label;
  const markdown = [`# ${title}`, ...parts.map((part, index) => `## ${index + 1}. ${part.title}\n\n${part.text}`)].join("\n\n");
  return { title, markdown, clauses: parts.map((part) => ({ key: part.key, version: part.version })), parts, unresolved: unresolvedOf(markdown) };
}

export function unresolvedOf(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[TO CONFIRM:\s*([^\]]+?)\s*\]\]/g)].map((match) => match[1]).slice(0, 200);
}

/** Variables an answer is still needed for, given the answers so far. Gated clauses ask only when their gate is on. */
export function relevantVariables(type: DocType, terms: Terms, kit: Kit = kitFor(type)): string[] {
  const out: string[] = [];
  const add = (key: string) => {
    if (!out.includes(key)) out.push(key);
  };
  for (const found of kit.clauses) {
    for (const gate of [found.when, found.unless]) if (gate) add(gate);
    if (!clauseApplies(found, terms)) continue;
    for (const match of found.body.matchAll(/\{\{(\w+)\}\}/g)) add(match[1]);
  }
  return out;
}

/** Variables never required to be answered: an empty answer means "does not apply". */
const GATES = new Set(["depositCents", "lateFeePercent", "rateChangeNoticeDays", "monthlyTotalCents", "sensitiveSurfaces", "customerPrepares", "purchaseOrderRequired", "autoRenew"]);

export function missingRequired(type: DocType, terms: Terms, kit?: Kit): string[] {
  return relevantVariables(type, terms, kit).filter((key) => !GATES.has(key) && !isAnswered(terms[key]));
}

// ── Deterministic validation ─────────────────────────────────────────────────────────────────────

export type Issue = { field?: string; message: string };
export type Validation = { errors: Issue[]; warnings: Issue[] };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Adds whole months to an ISO date, clamping to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const match = DATE.exec(iso)!;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const target = new Date(Date.UTC(y, m + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

const VISITS_PER_MONTH: Record<string, number> = { weekly: 52 / 12, "every two weeks": 26 / 12, "every four weeks": 13 / 12, monthly: 1 };

export function validate(type: DocType, terms: Terms, kit?: Kit): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  for (const [key, value] of Object.entries(terms)) {
    const def = defOf(kit, key);
    if (!def) {
      errors.push({ field: key, message: `"${key}" is not a field of this document.` });
      continue;
    }
    if (def.type === "money" && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) errors.push({ field: key, message: `${def.label} must be an amount of zero or more.` });
    if (def.type === "int" && (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000)) errors.push({ field: key, message: `${def.label} must be a whole number, zero or more.` });
    if (def.type === "date" && isAnswered(value) && !isIsoDate(value)) errors.push({ field: key, message: `${def.label} must be a real date (YYYY-MM-DD).` });
    if (def.type === "choice" && def.choices && isAnswered(value) && !def.choices.includes(String(value)) && key !== "governingState") errors.push({ field: key, message: `${def.label} must be one of: ${def.choices.join(", ")}.` });
    if (def.type === "bool" && typeof value !== "boolean") errors.push({ field: key, message: `${def.label} must be yes or no.` });
  }
  if (typeof terms.governingState === "string" && terms.governingState && !/^[A-Z]{2}$/.test(terms.governingState)) errors.push({ field: "governingState", message: "Use the two-letter state code, for example TX." });

  const start = terms.startDate;
  const effective = terms.changeEffective;
  if (isIsoDate(start) && isIsoDate(terms.separationDate) && terms.separationDate < start) errors.push({ field: "separationDate", message: "The last day cannot be before the start date." });
  if (isIsoDate(terms.authorizationEnds) && isIsoDate(start) && terms.authorizationEnds < start) errors.push({ field: "authorizationEnds", message: "The permission cannot end before the agreement starts." });
  if (isIsoDate(effective) && isIsoDate(start) && effective < start) warnings.push({ field: "changeEffective", message: "The change takes effect before the original start date." });

  const term = terms.termMonths;
  if (terms.autoRenew === true) {
    if (typeof term === "number" && term === 0) errors.push({ field: "autoRenew", message: "A one-time or zero-month agreement cannot renew automatically." });
    if (!isAnswered(terms.renewalNoticeDays)) errors.push({ field: "renewalNoticeDays", message: "Say how many days' notice must be given before an automatic renewal." });
    if (typeof term === "number" && typeof terms.renewalNoticeDays === "number" && terms.renewalNoticeDays > term * 30) errors.push({ field: "renewalNoticeDays", message: "The renewal notice is longer than the term itself." });
  }
  if (typeof terms.terminationNoticeDays === "number" && typeof term === "number" && term > 0 && terms.terminationNoticeDays > term * 30) errors.push({ field: "terminationNoticeDays", message: "The termination notice is longer than the term itself." });

  // Totals: a monthly total that does not follow from the visit price and frequency is called out, never silently fixed.
  const perVisit = terms.pricePerVisitCents;
  const monthly = terms.monthlyTotalCents;
  const frequency = typeof terms.frequency === "string" ? VISITS_PER_MONTH[terms.frequency] : undefined;
  if (typeof perVisit === "number" && typeof monthly === "number" && monthly > 0 && frequency !== undefined) {
    const expected = Math.round(perVisit * frequency);
    if (Math.abs(expected - monthly) > Math.max(100, expected * 0.02)) warnings.push({ field: "monthlyTotalCents", message: `Price per visit and frequency come to about $${(expected / 100).toFixed(2)} a month, but the monthly total is $${(monthly / 100).toFixed(2)}.` });
  }
  if (terms.frequency === "one time" && typeof term === "number" && term > 0) errors.push({ field: "termMonths", message: "A one-time service has no term in months." });
  if (typeof terms.depositCents === "number" && typeof perVisit === "number" && terms.depositCents > 0 && perVisit > 0 && terms.depositCents > perVisit * 3) warnings.push({ field: "depositCents", message: "The deposit is more than three visits' price. Some states limit deposits." });
  if (typeof terms.lateFeePercent === "number" && terms.lateFeePercent > 10) warnings.push({ field: "lateFeePercent", message: "A late fee above 10% a month may exceed what the law allows." });
  if (terms.purchaseOrderRequired === true && !isAnswered(terms.poNumber)) warnings.push({ field: "poNumber", message: "The customer requires a purchase order; enter its number before invoicing." });

  // Incompatible terms.
  if (type.key === "contractor_agreement" || type.key === "subcontractor_agreement") {
    if (terms.payBasis === "salary") errors.push({ field: "payBasis", message: "A salary does not fit an independent contractor engagement. Use an employment document, or pay by job or share." });
    if (terms.setsOwnSchedule === false && terms.ownEquipment === false) warnings.push({ field: "setsOwnSchedule", message: "The company controls the schedule and supplies the equipment. Those facts point toward an employee relationship in many states; the document title does not decide it." });
  }
  if ((type.key === "employee_offer" || type.key === "employment_agreement") && terms.payBasis === "share of job price") warnings.push({ field: "payBasis", message: "Pay by share of the job price is unusual for an employee; check minimum-wage and overtime rules." });
  if (type.key === "str_turnover" && terms.frequency === "one time") warnings.push({ field: "frequency", message: "A turnover agreement usually covers repeated bookings." });
  return { errors, warnings };
}

/** The hash a version is identified by. Approval and signatures are bound to it. */
export function contentHash(markdown: string): string {
  return sha256(markdown.replace(/\r\n/g, "\n"));
}

/** Which clauses a changed answer touches, so a revision can say what moved instead of silently rewriting. */
export function affectedClauses(type: DocType, before: Terms, after: Terms, kit: Kit = kitFor(type)): { key: string; title: string; changed: string[] }[] {
  const out: { key: string; title: string; changed: string[] }[] = [];
  for (const found of kit.clauses) {
    const names = [...new Set([...found.body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).concat(found.when ?? [], found.unless ?? []))];
    const changed = names.filter((name) => JSON.stringify(before[name] ?? null) !== JSON.stringify(after[name] ?? null));
    const appliedBefore = clauseApplies(found, before);
    const appliedAfter = clauseApplies(found, after);
    if (changed.length || appliedBefore !== appliedAfter) out.push({ key: found.key, title: found.title, changed });
  }
  return out;
}

export { docType };
