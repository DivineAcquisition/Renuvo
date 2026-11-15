/**
 * Where a model may help, and only here: deciding from a sender and subject whether an unknown message
 * looks like hiring mail, and reading the body of mail that does. It never sees the body of anything
 * else, it has no tools, and its answer is data that interpret.ts checks before anything is stored.
 *
 * No model is connected in this build. RECRUITER_MODEL is unset, so the rules reader does both jobs.
 * The interface is what a model adapter will implement; the mock lets tests stand in for one, including
 * one that has been talked into misbehaving.
 */
import { interpretByRule, type Interpretation } from "./interpret";
import type { MessageBody } from "./mail";
import type { Classification, Source } from "./schema";

export interface HiringModel {
  name: string;
  /** Sees the sender and the subject. Nothing else. */
  looksLikeHiring(input: { from: string; subject: string }): Promise<{ hiring: boolean; reason: string }>;
  /** Reads one message already judged to be hiring mail. */
  interpret(message: MessageBody, header: { source: Source; classification: Classification } | null): Promise<Interpretation>;
}

const HIRING_SUBJECT = /\b(appl(y|ying|ication|icant)|resume|cv|candidate|job (posting|opening|inquiry)|position|hiring|interview|cleaner (job|position|role))\b/i;

export const rulesModel: HiringModel = {
  name: "rules",
  async looksLikeHiring({ subject }) {
    const hiring = HIRING_SUBJECT.test(subject);
    return { hiring, reason: hiring ? "The subject is about applying for work." : "The subject is not about applying for work." };
  },
  async interpret(message, header) {
    return interpretByRule(message, header);
  },
};

/** What the mock model will answer, for tests. Unset entries fall back to the rules. */
export const mockModel: { looksLikeHiring: ((input: { from: string; subject: string }) => { hiring: boolean; reason: string }) | null; interpret: ((message: MessageBody) => Interpretation) | null; seen: { from: string; subject: string }[] } = {
  looksLikeHiring: null,
  interpret: null,
  seen: [],
};

const mock: HiringModel = {
  name: "mock",
  async looksLikeHiring(input) {
    mockModel.seen.push(input);
    return mockModel.looksLikeHiring ? mockModel.looksLikeHiring(input) : rulesModel.looksLikeHiring(input);
  },
  async interpret(message, header) {
    return mockModel.interpret ? mockModel.interpret(message) : rulesModel.interpret(message, header);
  },
};

export function hiringModel(): HiringModel {
  return process.env.RECRUITER_MODEL?.trim().toLowerCase() === "mock" ? mock : rulesModel;
}
