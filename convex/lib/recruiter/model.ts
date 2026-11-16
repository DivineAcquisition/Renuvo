/**
 * Where a model may help, and only here: deciding from a sender and subject whether an unknown message
 * looks like hiring mail, and reading the body of mail that does. It never sees the body of anything
 * else, it has no tools, and its answer is data that interpret.ts checks before anything is stored.
 *
 * RECRUITER_MODEL picks the reader: "claude" (claude.ts, needs ANTHROPIC_API_KEY), "mock" for tests,
 * anything else the rules reader. The mock lets tests stand in for a model, including one that has been
 * talked into misbehaving.
 */
import { claudeModel } from "./claude";
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

export async function rulesLooksLikeHiring({ subject }: { from: string; subject: string }): Promise<{ hiring: boolean; reason: string }> {
  const hiring = HIRING_SUBJECT.test(subject);
  return { hiring, reason: hiring ? "The subject is about applying for work." : "The subject is not about applying for work." };
}

export const rulesModel: HiringModel = {
  name: "rules",
  looksLikeHiring: rulesLooksLikeHiring,
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
  const choice = process.env.RECRUITER_MODEL?.trim().toLowerCase();
  if (choice === "mock") return mock;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (choice === "claude" && key) return claudeModel(key);
  return rulesModel;
}
