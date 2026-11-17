/**
 * Reading a bank or card statement export (CSV) into rows for Finance › Expenses. Pure, so it is tested
 * without a browser. Nothing here decides what is an expense: the server checks every row again.
 */
import { parseCsv } from "./csv";

export type StatementColumns = { date: number | null; description: number | null; amount: number | null; debit: number | null; credit: number | null };
/** How the file shows money going out: as negative amounts, as positive amounts, or in its own debit column. */
export type SpendSign = "negative" | "positive" | "debit_column";
export type StatementRow = { on: string; description: string; amountCents: number; moneyIn: boolean };
export type ParsedRow = { line: number; row: StatementRow | null; problem: string | null };

const GUESS: Record<keyof StatementColumns, string[]> = {
  date: ["date", "transaction date", "trans date", "posted date", "posting date", "post date"],
  description: ["description", "payee", "merchant", "name", "details", "memo", "transaction"],
  amount: ["amount", "transaction amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "charge", "charges"],
  credit: ["credit", "deposit", "deposits", "money in", "payment", "payments"],
};

export function guessStatementColumns(header: string[]): StatementColumns {
  const names = header.map((h) => h.trim().toLowerCase());
  const pick = (key: keyof StatementColumns) => {
    const exact = names.findIndex((n) => GUESS[key].includes(n));
    if (exact >= 0) return exact;
    const partial = names.findIndex((n) => GUESS[key].some((g) => n.includes(g)));
    return partial >= 0 ? partial : null;
  };
  const date = pick("date");
  const description = pick("description");
  const amount = pick("amount");
  const debit = pick("debit");
  const credit = pick("credit");
  return { date, description: description === date ? null : description, amount, debit: amount === null ? debit : null, credit: amount === null ? credit : null };
}

/** "02/27/2027", "2/27/27", "2027-02-27", "Feb 27, 2027" → "2027-02-27". US month-first order. */
export function statementDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else {
    const parsed = Date.parse(`${s} 12:00 UTC`);
    if (Number.isNaN(parsed)) return null;
    const date = new Date(parsed);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "-1,234.56", "(48.37)", "$48.37", "48.37 CR" → signed cents. Null when it isn't an amount. */
export function statementAmount(input: string): number | null {
  let s = input.trim().replace(/[$\s,]/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/CR$/i.test(s)) s = s.slice(0, -2);
  else if (/DR$/i.test(s)) {
    negative = !negative;
    s = s.slice(0, -2);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Each data row as a statement row, or the reason it can't be read. The header row is skipped. */
export function statementRows(table: string[][], columns: StatementColumns, sign: SpendSign): ParsedRow[] {
  return table.slice(1).map((cells, i) => {
    const line = i + 2;
    const on = columns.date === null ? null : statementDate(cells[columns.date] ?? "");
    const description = (columns.description === null ? "" : (cells[columns.description] ?? "")).trim();
    if (!on) return { line, row: null, problem: "No date" };
    if (!description) return { line, row: null, problem: "No description" };
    if (sign === "debit_column") {
      const debit = columns.debit === null ? null : statementAmount(cells[columns.debit] ?? "");
      const credit = columns.credit === null ? null : statementAmount(cells[columns.credit] ?? "");
      if (debit !== null && debit !== 0) return { line, row: { on, description, amountCents: Math.abs(debit), moneyIn: false }, problem: null };
      if (credit !== null && credit !== 0) return { line, row: { on, description, amountCents: Math.abs(credit), moneyIn: true }, problem: null };
      return { line, row: null, problem: "No amount" };
    }
    const amount = columns.amount === null ? null : statementAmount(cells[columns.amount] ?? "");
    if (amount === null || amount === 0) return { line, row: null, problem: "No amount" };
    const out = sign === "negative" ? amount < 0 : amount > 0;
    return { line, row: { on, description, amountCents: Math.abs(amount), moneyIn: !out }, problem: null };
  });
}

/** Which way the file most likely shows spending: if most amounts are negative, negative is money out. */
export function guessSign(table: string[][], columns: StatementColumns): SpendSign {
  if (columns.amount === null && columns.debit !== null) return "debit_column";
  const amounts = table.slice(1, 60).map((r) => (columns.amount === null ? null : statementAmount(r[columns.amount] ?? ""))).filter((a): a is number => a !== null && a !== 0);
  const negatives = amounts.filter((a) => a < 0).length;
  return negatives >= amounts.length / 2 ? "negative" : "positive";
}

export { parseCsv };
