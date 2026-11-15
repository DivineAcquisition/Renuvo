/**
 * Every message Recruiter sends to an applicant, as code. Each names the company, has one purpose, and
 * uses only details that are on the record: the first name and the job board are left out when they are
 * not known. None says the applicant is shortlisted, approved or hired, and none promises an interview
 * or work. A model does not write these.
 */
import type { Doc } from "../../_generated/dataModel";
import { firstName } from "./applications";
import type { Source } from "./schema";

const SOURCE_WORDS: Partial<Record<Source, string>> = { indeed: "Indeed", ziprecruiter: "ZipRecruiter" };

type Parts = { company: string; fromName: string; name?: string; role: string };

const greeting = (name: string | undefined) => {
  const first = firstName(name);
  return first ? `Hi ${first},` : "Hello,";
};

/** Who is writing, and how to stop it. On every email. */
const footer = (parts: Parts) =>
  `${parts.fromName}\n\nThis message was sent by ${parts.company}'s hiring assistant, an automated system. If you no longer want to hear from us about this application, reply to say so.`;

export function invitationEmail(parts: Parts & { source: Source }): { subject: string; body: string } {
  const via = SOURCE_WORDS[parts.source] ? ` through ${SOURCE_WORDS[parts.source]}` : "";
  return {
    subject: `Next step for your ${parts.role} application at ${parts.company}`,
    body: `${greeting(parts.name)}\n\nThank you for applying for the ${parts.role} position at ${parts.company}${via}.\n\nPlease complete our application so we can review your experience and availability:\n{link}\n\nIf you have any questions, reply to this email.\n\n${footer(parts)}`,
  };
}

export function followUpEmail(parts: Parts): { subject: string; body: string } {
  return {
    subject: `Reminder: your ${parts.role} application at ${parts.company}`,
    body: `${greeting(parts.name)}\n\nYour application for the ${parts.role} position at ${parts.company} is not finished yet. You can pick up where you left off:\n{link}\n\nIf you have any questions, reply to this email.\n\n${footer(parts)}`,
  };
}

export function followUpText(parts: Parts): string {
  return `${parts.company}: your ${parts.role} application is not finished yet. Continue here: {link} Reply STOP to opt out.`;
}

export function informationEmail(parts: Parts & { question: string }): { subject: string; body: string } {
  return {
    subject: `A question about your ${parts.role} application at ${parts.company}`,
    body: `${greeting(parts.name)}\n\nWe are reviewing your application for the ${parts.role} position at ${parts.company} and need one more thing from you:\n\n${parts.question}\n\nPlease reply to this email with your answer.\n\n${footer(parts)}`,
  };
}

export function interviewInvitationEmail(parts: Parts): { subject: string; body: string } {
  return {
    subject: `Choose a time to talk about your ${parts.role} application at ${parts.company}`,
    body: `${greeting(parts.name)}\n\nWe would like to talk with you about your application for the ${parts.role} position at ${parts.company}. Please choose a time that works for you:\n{link}\n\nIf none of the times work, reply to this email.\n\n${footer(parts)}`,
  };
}

export function interviewConfirmationEmail(parts: Parts & { when: string; how?: string }): { subject: string; body: string } {
  return {
    subject: `Your interview with ${parts.company}: ${parts.when}`,
    body: `${greeting(parts.name)}\n\nYour interview for the ${parts.role} position at ${parts.company} is set for ${parts.when}.${parts.how ? `\n\n${parts.how}` : ""}\n\nTo change or cancel it:\n{link}\n\n${footer(parts)}`,
  };
}

export function interviewReminderEmail(parts: Parts & { when: string }): { subject: string; body: string } {
  return {
    subject: `Reminder: your interview with ${parts.company}, ${parts.when}`,
    body: `${greeting(parts.name)}\n\nThis is a reminder of your interview for the ${parts.role} position at ${parts.company}, ${parts.when}.\n\nTo change or cancel it:\n{link}\n\n${footer(parts)}`,
  };
}

export function interviewReminderText(parts: Parts & { when: string }): string {
  return `${parts.company}: reminder of your interview for the ${parts.role} position, ${parts.when}. Change or cancel: {link} Reply STOP to opt out.`;
}

export function offerEmail(parts: Parts): { subject: string; body: string } {
  return {
    subject: `An offer from ${parts.company} for the ${parts.role} position`,
    body: `${greeting(parts.name)}\n\n${parts.company} would like to make you an offer for the ${parts.role} position. The terms are on this page, where you can accept or decline:\n{link}\n\nOpening the page does not accept anything. If you have questions, reply to this email.\n\n${footer(parts)}`,
  };
}

export function declineEmail(parts: Parts): { subject: string; body: string } {
  return {
    subject: `Your ${parts.role} application at ${parts.company}`,
    body: `${greeting(parts.name)}\n\nThank you for your interest in the ${parts.role} position at ${parts.company}. We will not be moving forward with your application for this role.\n\nWe appreciate the time you took to apply.\n\n${footer(parts)}`,
  };
}

export function urgentOutreachEmail(parts: Parts): { subject: string; body: string } {
  return {
    subject: `Your ${parts.role} application at ${parts.company}`,
    body: `${greeting(parts.name)}\n\nWe are looking at applications for the ${parts.role} position at ${parts.company} now. If you are still interested, reply to this email and tell us your availability this week.\n\nThis is not an offer of work. The usual application and onboarding steps still apply.\n\n${footer(parts)}`,
  };
}

export function partsFor(company: Doc<"companies">, fromName: string, applicant: Doc<"applicants">, role: string): Parts {
  return { company: company.name, fromName, name: applicant.name, role };
}
