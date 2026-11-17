import { describe, expect, it } from "vitest";

import { guessSign, guessStatementColumns, parseCsv, statementAmount, statementDate, statementRows } from "./expenses";

describe("reading a statement export", () => {
  it("reads dates and amounts the way banks write them", () => {
    expect(statementDate("02/27/2027")).toBe("2027-02-27");
    expect(statementDate("2/7/27")).toBe("2027-02-07");
    expect(statementDate("2027-02-27")).toBe("2027-02-27");
    expect(statementDate("Feb 27, 2027")).toBe("2027-02-27");
    expect(statementDate("02/30/2027")).toBeNull();
    expect(statementAmount("-1,234.56")).toBe(-123456);
    expect(statementAmount("(48.37)")).toBe(-4837);
    expect(statementAmount("$48.37")).toBe(4837);
    expect(statementAmount("12.5")).toBe(1250);
    expect(statementAmount("abc")).toBeNull();
  });

  it("finds the columns and which way spending is shown, then turns rows into spending and money in", () => {
    const table = parseCsv("Transaction Date,Post Date,Description,Category,Type,Amount\n02/27/2027,02/28/2027,HOME DEPOT #4521,Home,Sale,-48.37\n02/25/2027,02/26/2027,SHELL OIL 5741,Gas,Sale,-60.00\n02/23/2027,02/23/2027,PAYMENT THANK YOU,,Payment,500.00\n,,,,,\n");
    const columns = guessStatementColumns(table[0]);
    expect(columns).toMatchObject({ date: 0, description: 2, amount: 5 });
    expect(guessSign(table, columns)).toBe("negative");
    const rows = statementRows(table, columns, "negative");
    expect(rows.map((r) => r.row)).toEqual([
      { on: "2027-02-27", description: "HOME DEPOT #4521", amountCents: 4837, moneyIn: false },
      { on: "2027-02-25", description: "SHELL OIL 5741", amountCents: 6000, moneyIn: false },
      { on: "2027-02-23", description: "PAYMENT THANK YOU", amountCents: 50000, moneyIn: true },
    ]);
  });

  it("reads separate debit and credit columns", () => {
    const table = parseCsv("Date,Description,Debit,Credit\n2027-02-20,UNIFIRST,125.00,\n2027-02-21,DEPOSIT,,900.00\n2027-02-22,MISSING,,\n");
    const columns = guessStatementColumns(table[0]);
    expect(columns).toMatchObject({ date: 0, description: 1, amount: null, debit: 2, credit: 3 });
    expect(guessSign(table, columns)).toBe("debit_column");
    const rows = statementRows(table, columns, "debit_column");
    expect(rows[0].row).toEqual({ on: "2027-02-20", description: "UNIFIRST", amountCents: 12500, moneyIn: false });
    expect(rows[1].row?.moneyIn).toBe(true);
    expect(rows[2]).toMatchObject({ row: null, problem: "No amount" });
  });
});
