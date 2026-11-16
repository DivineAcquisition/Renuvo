/**
 * The shared clause library. One clause is written once and used by every agreement type that needs it,
 * so near-identical legal text is never copied per service. A clause has a version: an agreement records
 * the versions it was built from, and changing a clause here never changes an agreement already made.
 *
 * Bodies use {{variable}} placeholders (variables.ts). A clause with `when` appears only when that term
 * has a meaningful value. Nothing here is legal advice and none of it has recorded legal review.
 */
export type ClauseFlag = "classification" | "auto_renewal" | "liability" | "wage" | "background" | "separation" | "restrictive" | "deposit" | "privacy" | "indemnity";

export type Clause = {
  key: string;
  version: number;
  title: string;
  body: string;
  flags?: readonly ClauseFlag[];
  /** Included only when this variable is answered and not zero, false or empty. */
  when?: string;
  /** Included only when this variable is answered and is false. */
  unless?: string;
};

const c = (key: string, title: string, body: string, extra: Partial<Clause> = {}): Clause => ({ key, version: 1, title, body, ...extra });

export const CLAUSES: readonly Clause[] = [
  // ── Customer and service ──
  c("parties", "Parties", "This agreement is between {{companyName}} (the “Company”) and {{counterpartyName}} (the “Customer”)."),
  c("services_scope", "Services", "The Company will perform {{serviceName}} at {{serviceAddress}}. Each visit includes: {{scopeSummary}}."),
  c("exclusions_standards", "Exclusions and standard", "Not included: {{exclusions}}. A visit is complete when it meets this standard: {{serviceStandard}}."),
  c("sensitive_surfaces", "Sensitive surfaces", "The Customer will tell the Company about surfaces or items needing special care: {{sensitiveSurfaces}}. The Company will use reasonable care with them.", { when: "sensitiveSurfaces" }),
  c("schedule_frequency", "Schedule", "Service is {{frequency}}, during {{serviceWindow}}. A visit is expected to take about {{visitDurationHours}} hours."),
  c("pricing_payment", "Price and payment", "The price is {{pricePerVisitCents}} per visit. Invoices are due {{paymentDueDays}} days after they are issued. Payment is made by {{paymentMethod}}. No card or bank account number is written in or stored with this agreement."),
  c("monthly_billing", "Monthly billing", "The Company will bill {{monthlyTotalCents}} per month.", { when: "monthlyTotalCents" }),
  c("deposit", "Deposit", "A deposit of {{depositCents}} is due before the first visit.", { when: "depositCents", flags: ["deposit"] }),
  c("late_fee", "Late payment", "Overdue balances may carry a late fee of {{lateFeePercent}}% per month, where the law allows.", { when: "lateFeePercent" }),
  c("price_changes", "Price changes", "The Company will give {{rateChangeNoticeDays}} days' written notice before changing the price.", { when: "rateChangeNoticeDays" }),
  c("supplies_equipment", "Supplies and equipment", "Cleaning products and equipment are supplied by: {{suppliesBy}}. Customer preferences: {{specialProducts}}."),
  c("customer_prepares", "Customer's preparation", "Before each visit the Customer will: {{customerPrepares}}.", { when: "customerPrepares" }),
  c("access_property", "Access", "The crew will enter by: {{accessMethod}}. Alarms, pets and restricted areas: {{alarmPets}}. The Customer is responsible for keeping access information current."),
  c("rescheduling_cancellation", "Rescheduling and cancellation", "The Customer may reschedule or cancel with at least {{rescheduleNoticeHours}} hours' notice at no charge. Later changes may carry a fee of {{lateCancelFeeCents}}."),
  c("lockout_no_access", "No access", "If the crew cannot get in at the scheduled time: {{lockoutFeeCents}}."),
  c("concerns_corrective", "Service concerns", "The Customer should report a concern within {{concernWindowHours}} hours of a visit. The Company will respond with: {{correctiveRemedy}}."),
  c("additional_work", "Additional work", "Work outside the scope needs approval first: {{additionalWorkApproval}}."),
  c("damage_reporting", "Damage", "Either party should report damage within {{damageReportHours}} hours of discovering it, with photos when possible.", { flags: ["liability"] }),
  c("insurance_liability", "Insurance and liability", "The Company will describe the insurance it carries to the Customer on request. Nothing in this agreement limits either party's liability beyond what the law allows.", { flags: ["liability", "indemnity"] }),
  c("term_renewal", "Term", "This agreement starts {{startDate}} and runs {{termMonths}} months."),
  c("auto_renewal", "Automatic renewal", "At the end of the term this agreement renews automatically for successive periods of the same length unless either party gives {{renewalNoticeDays}} days' written notice before the renewal date. The Company will remind the Customer before each renewal.", { when: "autoRenew", flags: ["auto_renewal"] }),
  c("manual_renewal", "Renewal", "This agreement ends at the end of the term unless both parties agree in writing to renew it.", { unless: "autoRenew" }),
  c("termination", "Ending the agreement", "Either party may end this agreement with {{terminationNoticeDays}} days' written notice."),
  c("one_time_term", "One-time service", "This is a single service on {{startDate}} and does not renew."),
  c("governing_law", "Governing law", "This agreement is governed by the law of {{governingState}}."),
  c("amendments_notices", "Changes and notices", "Changes to this agreement must be in writing and accepted by both parties. A change to a signed agreement is made by amendment or replacement; the signed version is never overwritten."),
  // ── Short-term rental ──
  c("str_properties", "Properties", "This agreement covers: {{propertyList}}."),
  c("str_turnover", "Turnovers", "The Company will complete each turnover by: {{turnoverDeadline}}. Booking changes will be sent at least {{bookingChangeNoticeHours}} hours before a turnover."),
  c("str_linen", "Laundry and linens", "Linens and laundry: {{linenBy}}."),
  c("str_restock", "Restocking", "Restocking: {{restockItems}}."),
  c("str_emergency", "Emergencies", "In an emergency the Company may act, without waiting for approval, up to {{emergencyAuthCents}}, and will report it promptly."),
  // ── Commercial ──
  c("commercial_sites", "Sites and tasks", "The Company will clean these sites: {{siteList}}. Tasks and frequencies: {{taskFrequency}}."),
  c("commercial_after_hours", "After-hours access", "After-hours access is arranged as follows: {{afterHoursAccess}}."),
  c("commercial_consumables", "Consumables", "Consumables are supplied by: {{consumablesBy}}."),
  c("commercial_inspections", "Inspections", "The parties will hold service inspections: {{inspectionCadence}}."),
  c("commercial_contacts", "Authorized contacts", "These people may give instructions for the Customer: {{authorizedContacts}}."),
  c("commercial_po", "Purchase orders", "Invoices will carry purchase order {{poNumber}}.", { when: "purchaseOrderRequired" }),
  // ── Workforce ──
  c("worker_parties", "Parties", "This document is between {{companyName}} and {{workerName}}, for {{roleTitle}} at {{workLocation}}, starting {{engagementStart}}."),
  c("contractor_relationship", "Independent relationship", "The parties intend that {{workerName}} provides services as an independent contractor and not as an employee. Whether that is correct depends on the facts of the working relationship and the law of {{governingState}}.", { flags: ["classification"] }),
  c("contractor_work_terms", "How the work is done", "{{workerName}} chooses which jobs to accept: {{setsOwnSchedule}}. Uses their own tools and supplies: {{ownEquipment}}. Responsibilities: {{responsibilities}}.", { flags: ["classification"] }),
  c("worker_pay", "Pay", "Pay is set {{payBasis}}: {{payRateText}}, issued {{payFrequency}}.", { flags: ["wage"] }),
  c("employee_position", "Position", "The Company offers {{workerName}} the position of {{roleTitle}}. Responsibilities: {{responsibilities}}.", { flags: ["classification", "wage"] }),
  c("employment_terms", "Employment terms", "Employment is governed by the law of {{governingState}} and the Company's written policies. [[TO CONFIRM: at-will or other employment terms, reviewed by counsel]]", { flags: ["separation", "wage"] }),
  c("confidentiality", "Confidentiality", "{{workerName}} will keep customer information, access details and the Company's business information confidential and use them only for the work.", { flags: ["restrictive", "privacy"] }),
  c("customer_privacy", "Customer privacy", "{{workerName}} will not photograph, share or discuss customers' homes, belongings or personal information except as the Company's procedures require.", { flags: ["privacy"] }),
  c("equipment_issuance", "Equipment issued", "The Company issues: {{equipmentIssued}}. {{workerName}} will return them within {{returnDays}} days of a request or the end of the engagement.", { flags: ["wage"] }),
  c("access_items", "Keys, codes and access", "{{workerName}} has received: {{accessItems}}. They will be kept secure, used only for assigned work, never copied, and reported immediately if lost."),
  c("safety_training", "Safety and training", "{{workerName}} acknowledges receiving training on: {{trainingTopics}}."),
  c("handbook_ack", "Policy acknowledgment", "{{workerName}} acknowledges receiving {{handbookVersion}} and will ask about anything unclear. This acknowledgment does not change any employment terms."),
  c("background_disclosure", "Background-check disclosure", "{{companyName}} may obtain a background report about {{workerName}}. This disclosure is a separate document and is not combined with any other. [[TO CONFIRM: the disclosure and authorization text required by federal and state law, supplied by the screening provider or counsel]]", { flags: ["background"] }),
  c("compensation_change", "Compensation change", "Effective {{compensationEffective}}, pay becomes {{payRateText}}, {{payBasis}}.", { flags: ["wage"] }),
  c("separation", "Separation", "{{workerName}}'s last day is {{separationDate}}. Final pay, return of equipment ({{equipmentIssued}}) and access items are handled as described here. [[TO CONFIRM: final pay timing, benefits and any release, reviewed by counsel]]", { flags: ["separation", "wage"] }),
  // ── Supporting ──
  c("change_order", "Change", "This changes {{originalAgreement}}: {{changeDescription}}. Price effect: {{changeAmountCents}}. Effective {{changeEffective}}. All other terms stay as signed."),
  c("recurring_payment_auth", "Recurring payment authorization", "The Customer authorizes recurring charges for the service through the payment provider: {{paymentProviderRef}}. No card or bank number is held in this document, and the Customer may revoke the authorization through the provider."),
  c("key_holding", "Property access authorization", "The Customer authorizes the Company's crew to enter {{serviceAddress}} using: {{accessMethod}}."),
  c("photo_documentation", "Service documentation photos", "The Customer permits the crew to take photos of the work to document the service: {{photoUse}}. These photos are not used for advertising."),
  c("marketing_release", "Marketing release", "The Customer permits the Company to use: {{marketingUse}} for advertising. This permission is separate from service documentation, may be withdrawn in writing, and ends {{authorizationEnds}}."),
  c("renewal_extension", "Renewal or extension", "The parties agree to extend {{originalAgreement}}. Effective {{changeEffective}}. {{changeDescription}}"),
  c("notice_change", "Notice", "This is notice regarding {{originalAgreement}}: {{changeDescription}}. Effective {{changeEffective}}."),
  c("corrective_arrangement", "Corrective service", "For the concern described below the Company will: {{correctiveRemedy}}. Concern: {{changeDescription}}."),
  c("business_relationship", "Relationship", "{{companyName}} and {{counterpartyName}} agree to the following: {{scopeSummary}}."),
  c("commercial_confidentiality", "Mutual confidentiality", "Each party will keep the other's non-public information confidential and use it only for this relationship.", { flags: ["restrictive", "privacy"] }),
  c("data_processing", "Data handling", "The Company will handle the Customer's personal data only to provide the service and will follow the Customer's written data requirements. [[TO CONFIRM: the customer's required data terms, reviewed by counsel]]", { flags: ["privacy"] }),
  c("signatures", "Signatures", "Signed by the parties' authorized signers: {{companySigner}} for {{companyName}}, and {{counterpartySigner}}."),
];

export const CLAUSE_BY_KEY: ReadonlyMap<string, Clause> = new Map(CLAUSES.map((clause) => [clause.key, clause]));

export function clause(key: string): Clause {
  const found = CLAUSE_BY_KEY.get(key);
  if (!found) throw new Error(`Unknown clause ${key}`);
  return found;
}

/** The variable keys a clause body mentions. */
export function variablesOf(clauseBody: string): string[] {
  return [...new Set([...clauseBody.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]))];
}
