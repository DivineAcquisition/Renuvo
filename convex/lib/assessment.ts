/**
 * The operations assessment's questions, as the short answers that are stored. The words a visitor reads
 * are in src/lib/marketing/content.ts; a test keeps the two lists in step. An answer that is not on a
 * list is refused, here and on the web server.
 */
export const ASSESSMENT = {
  role: ["owner", "operations_manager", "other"],
  businessType: ["residential", "commercial", "short_term_rental", "combination"],
  cleaners: ["just_me", "1_4", "5_14", "15_29", "30_plus"],
  monthlyCleans: ["under_20", "20_49", "50_149", "150_299", "300_plus"],
  bookingTool: ["jobber", "housecall_pro", "bookingkoala", "gohighlevel", "another_platform", "manual"],
  help: ["sales", "recruiting", "dispatch", "retention"],
  openTo: ["test_one_workflow", "broader_move", "explore_later"],
} as const;

export type AssessmentQuestion = keyof typeof ASSESSMENT;
export const ASSESSMENT_QUESTIONS = Object.keys(ASSESSMENT) as AssessmentQuestion[];
export type AssessmentAnswers = { [Q in AssessmentQuestion]: (typeof ASSESSMENT)[Q][number] };

/** The agent each "needs the most help" answer points at. */
export const HELP_FOCUS = { sales: "Sales", recruiting: "Recruiting", dispatch: "Dispatch", retention: "Retention" } as const;

/** Every answer if all seven are on their lists, or null. */
export function checkedAnswers(input: Record<AssessmentQuestion, string>): AssessmentAnswers | null {
  for (const question of ASSESSMENT_QUESTIONS) {
    if (!(ASSESSMENT[question] as readonly string[]).includes(input[question])) return null;
  }
  return input as AssessmentAnswers;
}

/** An optional phone number: empty, or something with 7 to 15 digits. */
export function phoneOk(value: string): boolean {
  if (!value) return true;
  const digits = value.replace(/\D/g, "").length;
  return value.length <= 40 && digits >= 7 && digits <= 15 && /^[\d\s()+.\-x]+$/i.test(value);
}

/** An optional website or business page: empty, or one address with a dot in it and no spaces. */
export function websiteOk(value: string): boolean {
  return !value || (value.length <= 200 && !/\s/.test(value) && /^(https?:\/\/)?[^/.\s]+\.[^\s]{2,}$/i.test(value));
}
