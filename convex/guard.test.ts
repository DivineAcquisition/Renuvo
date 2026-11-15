import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { eventLogViolations, guardViolations, type GuardFile } from "./lib/guard";

function filesUnder(dir: string): GuardFile[] {
  const out: GuardFile[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith(".ts")) out.push({ path: full, source: readFileSync(full, "utf8") });
  }
  return out;
}

const tree = filesUnder(path.join(process.cwd(), "convex"));

describe("access builder guard", () => {
  it("catches a plain query, mutation or action, however it is imported", () => {
    const cases: GuardFile[] = [
      { path: "convex/open.ts", source: `import { query } from "./_generated/server";\nexport const list = query({ args: {}, handler: async () => [] });\n` },
      { path: "convex/renamed.ts", source: `import { mutation as write } from "./_generated/server";\nexport const save = write({ args: {}, handler: async () => null });\n` },
      { path: "convex/star.ts", source: `import * as server from "./_generated/server";\nexport const run = server.action({ args: {}, handler: async () => null });\n` },
      { path: "convex/generic.ts", source: `import { queryGeneric } from "convex/server";\nexport const list = queryGeneric({ args: {}, handler: async () => [] });\n` },
      { path: "convex/http.ts", source: `import { httpAction } from "./_generated/server";\nexport const hook = httpAction(async () => new Response());\n` },
    ];
    for (const file of cases) expect(guardViolations([file]), file.path).not.toEqual([]);
  });

  it("allows internal functions and type imports", () => {
    expect(
      guardViolations([
        {
          path: "convex/hidden.ts",
          source: `import { internalMutation, type MutationCtx } from "./_generated/server";\nexport const run = internalMutation({ args: {}, handler: async () => null });\n`,
        },
      ]),
    ).toEqual([]);
  });

  it("finds no plain query, mutation or action in convex/", () => {
    expect(tree.length).toBeGreaterThan(10);
    expect(guardViolations(tree)).toEqual([]);
  });
});

describe("event log guard", () => {
  it("catches a direct write to the log and a change to it", () => {
    expect(eventLogViolations([{ path: "convex/jobs.ts", source: `await ctx.db.insert("events", {});` }])).not.toEqual([]);
    expect(eventLogViolations([{ path: "convex/lib/events.ts", source: `await ctx.db.delete(id);` }])).not.toEqual([]);
  });

  it("finds one writer and no changes in convex/", () => {
    expect(eventLogViolations(tree)).toEqual([]);
  });
});
