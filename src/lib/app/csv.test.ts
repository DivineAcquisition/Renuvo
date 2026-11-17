import { describe, expect, it } from "vitest";

import { cell, guessColumns, parseCsv } from "./csv";

describe("csv", () => {
  it("reads quoted fields, doubled quotes, line breaks inside quotes and blank lines", () => {
    const rows = parseCsv('Name,Notes,Phone\r\n"Diaz, Rosa","Says ""hi""\nand bye",512-555-0101\r\n\r\nLena Park,,5125550102\n');
    expect(rows).toEqual([
      ["Name", "Notes", "Phone"],
      ["Diaz, Rosa", 'Says "hi"\nand bye', "512-555-0101"],
      ["Lena Park", "", "5125550102"],
    ]);
  });

  it("reads semicolon files and a byte-order mark", () => {
    expect(parseCsv("﻿Name;Areas\nRosa;78701, 78702")).toEqual([
      ["Name", "Areas"],
      ["Rosa", "78701, 78702"],
    ]);
  });

  it("guesses columns from headers, joining first and last name when there is no full name", () => {
    const columns = guessColumns(["First Name", "Last Name", "Mobile", "Email", "ZIP Codes", "Type"]);
    expect(columns).toMatchObject({ phone: 2, email: 3, serviceAreas: 4, engagement: 5 });
    expect(cell(["Rosa", "Diaz", "x"], columns.name)).toBe("Rosa Diaz");
  });
});
