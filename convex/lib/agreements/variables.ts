/**
 * The facts an agreement is built from. One registry, so a clause, a question and a validation rule all
 * talk about the same field. A value lives in an agreement's `terms`; a missing one is never invented: the
 * document shows it as [[TO CONFIRM: ...]] until a person answers.
 */
export type VarType = "text" | "longtext" | "money" | "date" | "int" | "bool" | "choice" | "list";

export type VarDef = {
  key: string;
  label: string;
  type: VarType;
  /** The intake group whose questions collect it. */
  group: string;
  /** The question a person is asked. */
  ask: string;
  choices?: readonly string[];
  /** Where a value may be taken from instead of asking: "company", "customer", "property", "worker". */
  prefill?: "company" | "customer" | "property" | "worker";
  help?: string;
};

export type TermValue = string | number | boolean | string[];
export type Terms = Record<string, TermValue>;

const defs: VarDef[] = [];
const def = (key: string, label: string, type: VarType, group: string, ask: string, extra: Partial<VarDef> = {}) => {
  defs.push({ key, label, type, group, ask, ...extra });
};

// ── Parties and place ────────────────────────────────────────────────────────────────────────────
def("companyName", "Company name", "text", "parties", "What is the company's legal name as it should appear?", { prefill: "company" });
def("companySigner", "Company signer", "text", "parties", "Who signs for the company, and what is their title?");
def("counterpartyName", "Customer or other party", "text", "parties", "Who is the other party (full legal name)?", { prefill: "customer" });
def("counterpartySigner", "Other party's signer", "text", "parties", "Who signs for them, and in what capacity?");
def("governingState", "Governing state", "choice", "parties", "Which state's law should govern, usually where the work is done?", { prefill: "company", help: "Rules for deposits, renewals, worker status and more differ by state." });
def("serviceAddress", "Service location", "text", "location", "What is the service address?", { prefill: "property" });
def("propertyType", "Property type", "choice", "location", "What kind of place is it?", { choices: ["home", "apartment", "short-term rental", "office", "commercial space", "construction site", "other"] });

// ── Scope and standards ──────────────────────────────────────────────────────────────────────────
def("serviceName", "Service", "text", "scope", "Which service is this for (for example Standard clean)?");
def("scopeSummary", "Scope of work", "longtext", "scope", "What is included in each visit?");
def("exclusions", "Exclusions", "longtext", "scope", "What is not included (for example inside appliances, exterior windows)?");
def("serviceStandard", "Service standard", "longtext", "scope", "How is a finished visit judged (checklist, photos, inspection)?");
def("areasIncluded", "Rooms or areas", "list", "scope", "Which rooms or areas are covered?");

// ── Schedule and term ────────────────────────────────────────────────────────────────────────────
def("frequency", "Frequency", "choice", "schedule", "How often is the service?", { choices: ["one time", "weekly", "every two weeks", "every four weeks", "monthly", "as needed"] });
def("serviceWindow", "Service window", "text", "schedule", "What days and times may the crew arrive?");
def("visitDurationHours", "Expected visit length (hours)", "int", "schedule", "About how long is each visit, in hours?");
def("startDate", "Start date", "date", "term", "When does the service start?");
def("termMonths", "Term (months)", "int", "term", "How long does the agreement run, in months? (0 for one time)");
def("autoRenew", "Renews automatically", "bool", "term", "Should it renew automatically at the end of the term?", { help: "Automatic renewals are regulated in many states." });
def("renewalNoticeDays", "Renewal notice (days)", "int", "term", "How many days before renewal must either side give notice?");
def("terminationNoticeDays", "Termination notice (days)", "int", "term", "How many days' notice ends the agreement?");

// ── Money ────────────────────────────────────────────────────────────────────────────────────────
def("pricePerVisitCents", "Price per visit", "money", "pricing", "What is the price per visit?");
def("monthlyTotalCents", "Monthly total", "money", "pricing", "What is the total per month, if billed monthly?");
def("depositCents", "Deposit", "money", "pricing", "Is a deposit required, and how much?");
def("paymentDueDays", "Payment due (days)", "int", "pricing", "How many days after an invoice is payment due?");
def("paymentMethod", "How payment is made", "choice", "pricing", "How will the customer pay?", { choices: ["card on file with the payment provider", "bank transfer through the payment provider", "check", "invoice", "other"], help: "Card and bank details are never stored in an agreement." });
def("lateFeePercent", "Late fee (%)", "int", "pricing", "Is there a late fee, as a percent per month? (0 for none)");
def("rateChangeNoticeDays", "Price-change notice (days)", "int", "pricing", "How much notice is given before a price change?");

// ── Access and responsibilities ──────────────────────────────────────────────────────────────────
def("accessMethod", "How the crew gets in", "longtext", "access", "How does the crew enter (key, code, lockbox, someone home)?");
def("alarmPets", "Alarm and pets", "longtext", "access", "Anything about alarms, pets or restricted areas?");
def("suppliesBy", "Supplies and equipment from", "choice", "supplies", "Who supplies cleaning products and equipment?", { choices: ["company", "customer", "shared"] });
def("specialProducts", "Customer-requested products", "longtext", "supplies", "Any products the customer requires or forbids?");
def("customerPrepares", "Customer's preparation", "longtext", "supplies", "What must the customer do before a visit (clear surfaces, secure valuables)?");

// ── Cancellations, concerns, extra work ──────────────────────────────────────────────────────────
def("rescheduleNoticeHours", "Reschedule notice (hours)", "int", "cancellation", "How many hours' notice is needed to reschedule without a fee?");
def("lateCancelFeeCents", "Late cancellation fee", "money", "cancellation", "What fee applies to a late cancellation? (0 for none)");
def("lockoutFeeCents", "No-access fee", "money", "cancellation", "What happens if the crew cannot get in (fee, rebooking)?");
def("concernWindowHours", "Report a concern within (hours)", "int", "concerns", "How long after a visit can the customer report a concern?");
def("correctiveRemedy", "Corrective work", "longtext", "concerns", "What will the company do if the customer is unsatisfied (return visit, credit)?");
def("additionalWorkApproval", "Additional work approval", "choice", "concerns", "How is extra work approved?", { choices: ["written approval before any extra work", "text or email approval before extra work", "not offered"] });
def("damageReportHours", "Damage reporting (hours)", "int", "concerns", "Within how many hours must damage be reported?");

// ── Short-term rental ────────────────────────────────────────────────────────────────────────────
def("propertyList", "Properties covered", "list", "str", "Which properties are covered (names or addresses)?");
def("turnoverDeadline", "Turnover deadline", "text", "str", "What is the deadline for a turnover (for example by 3 PM same day)?");
def("bookingChangeNoticeHours", "Booking-change notice (hours)", "int", "str", "How soon must booking changes be sent to the crew?");
def("linenBy", "Linen and laundry", "choice", "str", "Who handles linens and laundry?", { choices: ["company launders host linens", "company swaps host-provided linens", "host handles laundry", "third-party service"] });
def("restockItems", "Restocking", "longtext", "str", "What does the crew restock, and who pays for it?");
def("emergencyAuthCents", "Emergency spending limit", "money", "str", "Up to what amount may the crew act in an emergency without asking?");

// ── Commercial and office ────────────────────────────────────────────────────────────────────────
def("siteList", "Sites", "list", "commercial", "Which sites are covered?");
def("taskFrequency", "Task frequencies", "longtext", "commercial", "Which tasks happen how often (daily trash, weekly floors)?");
def("afterHoursAccess", "After-hours access", "longtext", "commercial", "How is after-hours access arranged (badges, codes, alarm)?");
def("consumablesBy", "Consumables", "choice", "commercial", "Who supplies paper, soap and other consumables?", { choices: ["company, billed at cost", "company, included in price", "customer"] });
def("inspectionCadence", "Inspections", "text", "commercial", "How often are service inspections held?");
def("authorizedContacts", "Authorized contacts", "list", "commercial", "Who may give instructions on the customer's behalf?");
def("purchaseOrderRequired", "Purchase order required", "bool", "commercial", "Does the customer require a purchase order number on invoices?");
def("poNumber", "Purchase order number", "text", "commercial", "What is the purchase order number?");

// ── Workforce ────────────────────────────────────────────────────────────────────────────────────
def("workerName", "Worker or company name", "text", "worker", "Who is the worker (or subcontracting company)?", { prefill: "worker" });
def("roleTitle", "Role or services", "text", "worker", "What role or services?");
def("workLocation", "Work location", "text", "worker", "Where is the work done?");
def("engagementStart", "Start date", "date", "worker", "When does the engagement start?");
def("payBasis", "How pay is set", "choice", "worker", "How is pay set?", { choices: ["per job", "share of job price", "hourly", "salary"] });
def("payRateText", "Pay rate", "text", "worker", "What is the rate (for example 50% of job price or $18/hour)?");
def("payFrequency", "Pay schedule", "text", "worker", "How often is pay issued?");
def("responsibilities", "Responsibilities", "longtext", "worker", "What are the main responsibilities?");
def("equipmentIssued", "Equipment and uniforms issued", "list", "worker", "What equipment or uniforms are issued?");
def("returnDays", "Return within (days)", "int", "worker", "Within how many days must equipment be returned?");
def("accessItems", "Keys, codes and access items", "list", "worker", "Which keys, codes or access items are covered?");
def("trainingTopics", "Training and safety topics", "list", "worker", "Which training or safety topics are acknowledged?");
def("ownEquipment", "Worker supplies own equipment", "bool", "worker", "Does the worker use their own tools and supplies?");
def("setsOwnSchedule", "Worker sets own schedule", "bool", "worker", "Does the worker choose which jobs to accept and when?");
def("handbookVersion", "Handbook version", "text", "worker", "Which handbook or policy version is acknowledged?");
def("compensationEffective", "Compensation change effective", "date", "worker", "When does the compensation change take effect?");
def("separationDate", "Separation date", "date", "worker", "What is the last day?");

// ── Supporting documents ─────────────────────────────────────────────────────────────────────────
def("changeDescription", "Change", "longtext", "change", "What is changing?");
def("changeAmountCents", "Change in price", "money", "change", "What is the price effect of the change?");
def("changeEffective", "Effective date", "date", "change", "When does the change take effect?");
def("originalAgreement", "Agreement being changed", "text", "change", "Which agreement does this change?");
def("photoUse", "Photo use", "choice", "photo", "What may photos of the service be used for?", { choices: ["service documentation only", "documentation and quality review"] });
def("marketingUse", "Marketing use", "choice", "photo", "What marketing use is permitted?", { choices: ["before-and-after photos", "testimonial text", "both"] });
def("authorizationEnds", "Permission ends", "date", "photo", "Does the permission end on a date?");
def("paymentProviderRef", "Payment provider authorization", "text", "pricing", "Which payment-provider authorization or customer reference applies? (never card or bank numbers)");
def("sensitiveSurfaces", "Sensitive surfaces", "longtext", "scope", "Which surfaces or items need special care (stone, antiques, unsealed wood)?");

export const VARIABLES: readonly VarDef[] = defs;
export const VARIABLE_BY_KEY: ReadonlyMap<string, VarDef> = new Map(defs.map((d) => [d.key, d]));

export function variable(key: string): VarDef {
  const found = VARIABLE_BY_KEY.get(key);
  if (!found) throw new Error(`Unknown agreement variable ${key}`);
  return found;
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A term as it reads in a document. */
export function formatTerm(def: VarDef, value: TermValue): string {
  switch (def.type) {
    case "money":
      return typeof value === "number" ? usd(value) : String(value);
    case "bool":
      return value === true ? "Yes" : "No";
    case "list":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "date": {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      if (!match) return String(value);
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
    }
    default:
      return String(value);
  }
}

/** True when a term has been given a usable value. An empty string, list or NaN is not an answer. */
export function isAnswered(value: TermValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
