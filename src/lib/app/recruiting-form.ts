/**
 * Recruiting rules as a form. The saved settings arrive with Recruiter's defaults filled in; the form
 * keeps text the way it is typed and turns it back into the numbers the server checks.
 */
export type RecruitingSettings = {
  invitationMode: "review" | "auto";
  followUpHours: number[];
  maxFollowUps: number;
  sendFromMinute: number;
  sendUntilMinute: number;
  sendDays: number[];
  fromName: string;
  replyTo: string | null;
  linkTtlDays: number;
  offerTtlDays: number;
  retentionDays: number;
  interviewMinutes: number;
  interviewReminderHours: number;
  decideWithinHours: number;
  onboardingRequirements: { key: string; label: string }[];
  recruitingRules: string | null;
  communicationPolicy: string | null;
  escalationRules: string | null;
};

export type RecruitingForm = {
  invitationMode: "review" | "auto";
  followUpHours: string;
  maxFollowUps: string;
  sendFrom: string;
  sendUntil: string;
  sendDays: number[];
  fromName: string;
  replyTo: string;
  linkTtlDays: string;
  offerTtlDays: string;
  retentionDays: string;
  interviewMinutes: string;
  interviewReminderHours: string;
  decideWithinHours: string;
  requirements: { key: string; label: string }[];
  recruitingRules: string;
  communicationPolicy: string;
  escalationRules: string;
};

const time = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function minuteOf(value: string, end = false): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return end && minute === 0 ? 1440 : minute;
}

export function formFrom(settings: RecruitingSettings): RecruitingForm {
  return {
    invitationMode: settings.invitationMode,
    followUpHours: settings.followUpHours.join(", "),
    maxFollowUps: String(settings.maxFollowUps),
    sendFrom: time(settings.sendFromMinute),
    sendUntil: settings.sendUntilMinute >= 1440 ? "00:00" : time(settings.sendUntilMinute),
    sendDays: [...settings.sendDays],
    fromName: settings.fromName,
    replyTo: settings.replyTo ?? "",
    linkTtlDays: String(settings.linkTtlDays),
    offerTtlDays: String(settings.offerTtlDays),
    retentionDays: String(settings.retentionDays),
    interviewMinutes: String(settings.interviewMinutes),
    interviewReminderHours: String(settings.interviewReminderHours),
    decideWithinHours: String(settings.decideWithinHours),
    requirements: settings.onboardingRequirements.map((row) => ({ ...row })),
    recruitingRules: settings.recruitingRules ?? "",
    communicationPolicy: settings.communicationPolicy ?? "",
    escalationRules: settings.escalationRules ?? "",
  };
}

const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

/** The settings the server validates. Anything not a number is NaN, which the server refuses in words. */
export function settingsFrom(form: RecruitingForm) {
  return {
    invitationMode: form.invitationMode,
    followUpHours: form.followUpHours.split(/[\s,;]+/).filter(Boolean).map(Number),
    maxFollowUps: number(form.maxFollowUps),
    sendFromMinute: minuteOf(form.sendFrom),
    sendUntilMinute: minuteOf(form.sendUntil, true),
    sendDays: [...form.sendDays].sort(),
    fromName: form.fromName,
    replyTo: form.replyTo,
    linkTtlDays: number(form.linkTtlDays),
    offerTtlDays: number(form.offerTtlDays),
    retentionDays: number(form.retentionDays),
    interviewMinutes: number(form.interviewMinutes),
    interviewReminderHours: number(form.interviewReminderHours),
    decideWithinHours: number(form.decideWithinHours),
    onboardingRequirements: form.requirements.map((row) => ({ key: row.key, label: row.label })),
    recruitingRules: form.recruitingRules,
    communicationPolicy: form.communicationPolicy,
    escalationRules: form.escalationRules,
  };
}

/** Checked in the browser too, so the common mistakes are named beside the form before anything is sent. */
export function recruitingProblems(form: RecruitingForm): string[] {
  const out: string[] = [];
  const settings = settingsFrom(form);
  const reminders = settings.followUpHours;
  if (reminders.some((hours) => !Number.isFinite(hours))) out.push("Reminder delays must be numbers of hours.");
  if (new Set(reminders).size !== reminders.length) out.push("Two reminders are set for the same time.");
  if (reminders.length > 5) out.push("There can be at most five reminders.");
  if (Number.isFinite(settings.maxFollowUps) && settings.maxFollowUps > reminders.length) out.push("The number of reminders sent cannot be more than the reminders scheduled.");
  if (!(settings.sendFromMinute < settings.sendUntilMinute)) out.push("Sending hours must end after they start.");
  if (settings.sendDays.length === 0) out.push("Choose at least one day messages may be sent.");
  if (form.requirements.length === 0) out.push("A new worker needs at least one onboarding requirement.");
  const keys = form.requirements.map((row) => row.key.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) out.push("Two onboarding requirements share a key.");
  if (form.requirements.some((row) => !row.key.trim() || !row.label.trim())) out.push("Each onboarding requirement needs a key and a label.");
  return out;
}
