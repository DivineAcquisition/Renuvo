/**
 * Plain arithmetic for chat: + − × ÷, %, ^ and parentheses over numbers. No names, no functions, no
 * code. A model asks; this answers, so a total in a reply is computed, never guessed.
 */

export class CalcError extends Error {}

type Token = { kind: "num"; value: number } | { kind: "op"; value: string };

function tokens(expression: string): Token[] {
  const out: Token[] = [];
  const source = expression.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,(?=\d{3}\b)/g, "").replace(/\$/g, "");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^\d+(\.\d+)?|^\.\d+/.exec(source.slice(index));
    if (number) {
      out.push({ kind: "num", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    if ("+-*/%^()".includes(char)) {
      out.push({ kind: "op", value: char });
      index += 1;
      continue;
    }
    throw new CalcError(`"${char}" is not arithmetic.`);
  }
  return out;
}

export function evaluate(expression: string): number {
  if (expression.length > 500) throw new CalcError("The expression is too long.");
  const list = tokens(expression);
  let at = 0;
  const peek = () => list[at];
  const take = (value?: string) => {
    const token = list[at];
    if (!token || (value !== undefined && (token.kind !== "op" || token.value !== value))) throw new CalcError("The expression is not complete.");
    at += 1;
    return token;
  };

  // expression := term (("+" | "-") term)*
  const expressionRule = (): number => {
    let value = term();
    while (peek()?.kind === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = take().value;
      value = op === "+" ? value + term() : value - term();
    }
    return value;
  };
  // term := power (("*" | "/" | "%") power)*
  const term = (): number => {
    let value = power();
    while (peek()?.kind === "op" && ["*", "/", "%"].includes(peek()!.value as string)) {
      const op = take().value;
      const right = power();
      if ((op === "/" || op === "%") && right === 0) throw new CalcError("Division by zero.");
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  // power := unary ("^" power)?
  const power = (): number => {
    const base = unary();
    if (peek()?.kind === "op" && peek()!.value === "^") {
      take();
      return base ** power();
    }
    return base;
  };
  const unary = (): number => {
    if (peek()?.kind === "op" && peek()!.value === "-") {
      take();
      return -unary();
    }
    if (peek()?.kind === "op" && peek()!.value === "+") {
      take();
      return unary();
    }
    return primary();
  };
  const primary = (): number => {
    const token = take();
    if (token.kind === "num") return token.value;
    if (token.value === "(") {
      const value = expressionRule();
      take(")");
      return value;
    }
    throw new CalcError("The expression is not complete.");
  };

  if (list.length === 0) throw new CalcError("There is nothing to calculate.");
  const value = expressionRule();
  if (at !== list.length) throw new CalcError("The expression has something left over.");
  if (!Number.isFinite(value)) throw new CalcError("The result is not a finite number.");
  return Math.round(value * 1e10) / 1e10;
}
