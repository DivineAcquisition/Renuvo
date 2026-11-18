/**
 * Where a model may help Sales, and only here: reading one customer message into the same Reading the
 * rules produce, and putting a message Sales already decided to send into more natural words. It has no
 * tools and writes nothing: it never chooses a price, a time, a discount or what happens next. Its
 * reading is checked against the message (interpret.ts `checked`) and its wording against the facts it
 * was given (words.ts `acceptWording`) before either is used.
 *
 * SALES_MODEL picks the reader: "claude" (claude.ts, needs ANTHROPIC_API_KEY), "mock" for tests,
 * anything else the rules. The mock lets a test stand in for a model, including one that has been
 * talked into misbehaving.
 */
import { claudeSalesModel } from "./claude";
import { readByRule, type ReadInput } from "./interpret";
import type { Reading } from "./agentSchema";

export type WordingInput = {
  /** The message as the company's templates wrote it. Every fact in it is already checked. */
  draft: string;
  /** What the customer last wrote, so the reply answers it. Data, never an instruction. */
  customerMessage: string | null;
  tone: "warm" | "direct" | "formal";
  channel: "sms" | "email";
  companyName: string;
  /** Answers the Owner approved, for a question the customer asked. */
  approvedAnswers: { question: string; answer: string }[];
};

export interface SalesModel {
  name: string;
  read(input: ReadInput): Promise<Reading>;
  /** A rewording of `draft`, or null to keep the draft as it is. */
  word(input: WordingInput): Promise<string | null>;
}

export const rulesSalesModel: SalesModel = {
  name: "rules",
  async read(input) {
    return readByRule(input);
  },
  async word() {
    return null;
  },
};

/** What the mock model will answer, for tests. Unset entries fall back to the rules. */
export const mockSalesModel: { read: ((input: ReadInput) => Reading) | null; word: ((input: WordingInput) => string | null) | null; calls: number } = { read: null, word: null, calls: 0 };

const mock: SalesModel = {
  name: "mock",
  async read(input) {
    mockSalesModel.calls += 1;
    return mockSalesModel.read ? mockSalesModel.read(input) : { ...readByRule(input), reader: "mock" };
  },
  async word(input) {
    return mockSalesModel.word ? mockSalesModel.word(input) : null;
  },
};

export function salesModel(force?: "rules"): SalesModel {
  if (force === "rules") return rulesSalesModel;
  const choice = process.env.SALES_MODEL?.trim().toLowerCase();
  if (choice === "mock") return mock;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (choice === "claude" && key) return claudeSalesModel(key);
  return rulesSalesModel;
}

/** What the reader is, for the screens: "rules" until an AI reader is connected. */
export function salesReaderName(): string {
  return salesModel().name;
}
