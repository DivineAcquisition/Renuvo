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
  /** One entry per reminder, in hours after the invitation, as typed. */
  followUpHours: string[];
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
    followUpHours: settings.followUpHours.map(String),
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
    followUpHours: form.followUpHours.map((value) => value.trim()).filter(Boolean).map(Number),
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
  if (reminders.some((hours) => !Number.isInteger(hours))) out.push("Follow-ups: enter each reminder as a whole number of hours, like 48.");
  else if (reminders.some((hours) => hours < 12 || hours > 720)) out.push("Follow-ups: each reminder must be between 12 hours and 720 hours (30 days) after the invitation.");
  if (new Set(reminders).size !== reminders.length) out.push("Follow-ups: two reminders are set for the same time.");
  if (reminders.length > 5) out.push("Follow-ups: there can be at most five reminders.");
  if (Number.isFinite(settings.maxFollowUps) && settings.maxFollowUps > reminders.length) out.push("Follow-ups: you can't send more reminders than you've scheduled.");
  if (!(settings.sendFromMinute < settings.sendUntilMinute)) out.push("Messages: the sending window must end after it starts.");
  if (settings.sendDays.length === 0) out.push("Messages: choose at least one day messages can be sent.");
  if (form.requirements.length === 0) out.push("New hires: add at least one requirement.");
  const keys = form.requirements.map((row) => row.key.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) out.push("New hires: two requirements have the same name.");
  if (form.requirements.some((row) => !row.label.trim())) out.push("New hires: give every requirement a name.");
  return out;
}

/** A stable key for a new requirement, from its name. Existing requirements keep theirs. */
export function requirementKey(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "requirement";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}
