/**
 * Review prompts for the places agreements most often go wrong, by topic and state. These are prompts
 * to ask a lawyer or the right agency, written conservatively from general knowledge. They are not legal
 * advice, they are not an up-to-date survey of the law, and they never say a document is compliant or
 * enforceable. Selestial has no web access and no legal database: where this table has nothing specific
 * for a state, it says so and says to confirm locally.
 *
 * A prompt appears once, at the decision it concerns, not as a disclaimer on every page.
 */
import type { ClauseFlag } from "./clauses";
import type { Terms } from "./variables";

export type Note = { topic: ClauseFlag | "arbitration" | "cooling_off"; title: string; why: string; ask: string; state?: string; severity: "review" | "specialist" };

/** What is widely known to differ. Each entry names the state and the rule's subject, not a guarantee of the current text. */
const STATE_NOTES: Record<string, Partial<Record<Note["topic"], string>>> = {
  CA: {
    classification: "California applies the “ABC test” to many worker-status questions. A contractor label often does not hold.",
    restrictive: "California generally voids employee non-compete clauses and limits other restrictive covenants.",
    auto_renewal: "California's automatic renewal law sets disclosure, consent and cancellation requirements for consumer subscriptions.",
    wage: "California has strict rules on deductions, final pay timing, and expense reimbursement.",
    background: "California has additional background-check disclosure and fair-chance hiring rules.",
  },
  NY: { auto_renewal: "New York restricts automatic renewals in consumer contracts and requires clear disclosure.", wage: "New York limits wage deductions and has pay-notice requirements." },
  NJ: { classification: "New Jersey applies a strict ABC-style test to worker status.", auto_renewal: "New Jersey regulates automatic renewal and consumer contract wording." },
  MA: { classification: "Massachusetts applies an ABC-style test to independent-contractor status.", wage: "Massachusetts has strict wage-payment and deduction rules." },
  IL: { background: "Illinois has specific rules on background checks and criminal-history inquiries.", auto_renewal: "Illinois has an automatic renewal statute for consumer contracts." },
  MN: { restrictive: "Minnesota restricts employee non-compete agreements." },
  TX: { deposit: "Texas has few statewide limits on service deposits, but contract wording still matters." },
  WA: { classification: "Washington applies several tests to worker status, depending on the law.", restrictive: "Washington limits non-compete agreements by pay level and notice." },
  CO: { restrictive: "Colorado limits non-compete agreements and requires specific notice." },
  OR: { classification: "Oregon applies its own tests to worker status.", restrictive: "Oregon limits non-compete agreements." },
};

const BASE: Record<ClauseFlag, { title: string; why: string; ask: string; severity: Note["severity"] }> = {
  classification: { title: "Worker status", why: "Whether someone is a contractor or an employee depends on how the work is actually controlled and on state and federal tests, not on the document's title.", ask: "Have an employment lawyer or your state labor agency confirm the classification before you rely on this.", severity: "specialist" },
  wage: { title: "Pay terms", why: "Pay, deductions, overtime and final-pay timing are regulated differently by state and by worker status.", ask: "Confirm pay terms and any deductions or equipment charges against your state's wage rules.", severity: "specialist" },
  background: { title: "Background checks", why: "A background-check disclosure must usually be a separate, standalone document, and several states add their own notices and limits.", ask: "Get the disclosure and authorization text from your screening provider or counsel; do not combine it with other terms.", severity: "specialist" },
  separation: { title: "Separation terms", why: "Final pay timing, benefits notices and any release of claims are tightly regulated and differ by state.", ask: "Have counsel review any separation document before it is offered.", severity: "specialist" },
  restrictive: { title: "Confidentiality and restrictive terms", why: "Confidentiality is common, but non-competes, non-solicits and broad restrictions are limited or void in some states.", ask: "Keep confidentiality narrow, and do not add a non-compete without counsel.", severity: "review" },
  liability: { title: "Liability and damage", why: "Limits on liability and damage-reporting terms may be unenforceable or unfair if too broad.", ask: "Have counsel review any limit on liability and confirm your insurance matches what you promise.", severity: "review" },
  indemnity: { title: "Indemnity", why: "Indemnity language shifts risk and is easy to draft too broadly.", ask: "Do not add indemnity wording without counsel.", severity: "specialist" },
  auto_renewal: { title: "Automatic renewal", why: "Many states require clear disclosure, consent and an easy way to cancel, and some require a reminder before each renewal.", ask: "Confirm your state's renewal rules; Selestial will prepare a reminder but never renews on its own.", severity: "review" },
  deposit: { title: "Deposits", why: "Some states limit or regulate deposits and their refund.", ask: "Check whether your state limits deposits for services like yours.", severity: "review" },
  privacy: { title: "Privacy", why: "Customer data, photos and access details are sensitive, and customers may require specific handling terms.", ask: "Match this to your customers' data requirements and your privacy notice.", severity: "review" },
};

const NAMES: Record<string, string> = { classification: "classification", wage: "wage", background: "background", separation: "separation", restrictive: "restrictive", liability: "liability", indemnity: "indemnity", auto_renewal: "auto_renewal", deposit: "deposit", privacy: "privacy" };

/** The prompts that apply to the clauses a document uses, in the state named (or generally if none). */
export function reviewNotes(flags: readonly ClauseFlag[], state: string | undefined, terms: Terms = {}): Note[] {
  const seen = new Set<string>();
  const notes: Note[] = [];
  for (const flag of flags) {
    if (seen.has(flag)) continue;
    seen.add(flag);
    const base = BASE[flag];
    const specific = state ? STATE_NOTES[state.toUpperCase()]?.[flag] : undefined;
    const stateLine = state ? (specific ? ` ${state.toUpperCase()}: ${specific}` : ` Rules differ by state and none are summarized here for ${state.toUpperCase()}; confirm locally.`) : " No state was given, so confirm the rules where the work is done.";
    notes.push({ topic: flag, title: base.title, why: `${base.why}${stateLine}`, ask: base.ask, state: state?.toUpperCase(), severity: base.severity });
  }
  if (terms.autoRenew === true && !seen.has("auto_renewal")) notes.push({ topic: "auto_renewal", title: BASE.auto_renewal.title, why: BASE.auto_renewal.why, ask: BASE.auto_renewal.ask, state: state?.toUpperCase(), severity: "review" });
  return notes;
}

export const LEGAL_NOTICE = "These are review prompts from general knowledge, not legal advice, and they may be out of date. Selestial has no legal database or web access. Documents are drafts built from your information and a starting template.";

export const FLAG_KEYS = Object.keys(NAMES);
