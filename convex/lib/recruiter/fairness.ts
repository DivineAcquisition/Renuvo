/**
 * A guard on what an application may ask and what screening may test. It refuses wording about
 * characteristics that must not decide who is hired, and common stand-ins for them. It is a list of
 * words, not legal advice: it will miss things, and passing it does not make a question lawful.
 *
 * LEGAL REVIEW: minimum-age and work-authorization questions are refused here too, although some forms
 * of them are lawful, because how and when they may be asked differs by state. They belong in
 * onboarding until counsel has approved wording (docs/recruiter/05-assumptions.md).
 */
import { userError } from "../errors";

const PROTECTED: { pattern: RegExp; about: string }[] = [
  { pattern: /\b(age|how old|years old|date of birth|birth ?date|birthday|born in|graduat(ed|ion) year|18 or older|over 18|young|youthful|mature|elderly|senior citizen|recent graduate|digital native)\b/i, about: "age" },
  { pattern: /\b(race|racial|ethnic|ethnicity|skin colou?r|national origin|nationality|ancestry|country (of origin|were you born)|native (language|speaker|tongue)|accent|mother tongue)\b/i, about: "race, ethnicity or national origin" },
  { pattern: /\b(citizen|citizenship|immigra|visa|green card|work (permit|authorization)|authorized to work|legal status|social security)\b/i, about: "citizenship or immigration status" },
  { pattern: /\b(religio|church|mosque|temple|synagogue|faith|sabbath|worship)\b/i, about: "religion" },
  { pattern: /\b(gender|sex|sexual|orientation|transgender|pronouns?|male|female|wom[ae]n|m[ae]n|ladies|lady|girls?|boys?|guys?)\b/i, about: "sex, gender or orientation" },
  { pattern: /\b(pregnan|maternity|marital|married|single|spouse|husband|wife|children|kids|child ?care|family (status|plans)|dependents?)\b/i, about: "pregnancy, marital or family status" },
  { pattern: /\b(disab|handicap|medical|health (condition|problem|issue)|illness|medication|diagnos|genetic|workers'? comp|sick days)\b/i, about: "disability or health" },
  { pattern: /\b(veteran|military (status|discharge)|arrest|convict|criminal|felony|misdemeanou?r|record check|credit (score|history|check)|bankrupt|union|political|photo(graph)? of (you|yourself)|height|weight)\b/i, about: "a characteristic that needs legal review before it can be asked" },
];

/** Why this wording may not be used in a question or a requirement, or null. */
export function protectedWording(text: string): string | null {
  const hit = PROTECTED.find((entry) => entry.pattern.test(text));
  return hit ? hit.about : null;
}

export function assertJobRelated(text: string, what: string): void {
  const about = protectedWording(text);
  if (about) throw userError(`${what} appears to be about ${about}. Recruiter does not ask about or screen on that. If you believe this is a lawful, job-related requirement, have it reviewed by counsel first.`);
}
