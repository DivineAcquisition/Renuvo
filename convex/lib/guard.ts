const RAW = new Set(["query", "mutation", "action", "httpAction"]);

export type GuardFile = { path: string; source: string };

/** Every public function must be registered through convex/lib/builders.ts. Internal functions are not public. */
export function guardViolations(files: GuardFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.endsWith(".test.ts")) continue;
    if (file.path.includes("/_generated/")) continue;
    // The builders register functions; this file only names the words it looks for.
    if (file.path.endsWith("lib/builders.ts") || file.path.endsWith("lib/guard.ts")) continue;
    const imports = file.source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*_generated\/server["']/g);
    for (const match of imports) {
      for (const specifier of match[1].split(",")) {
        const imported = specifier.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (imported && RAW.has(imported)) violations.push(`${file.path} imports ${imported} from the generated server`);
      }
    }
    for (const match of file.source.matchAll(/import\s*\*\s*as\s+\w+\s*from\s*["'][^"']*_generated\/server["']/g)) {
      violations.push(`${file.path} imports everything from the generated server (${match[0]})`);
    }
    for (const match of file.source.matchAll(/export\s+(?:const|let|var)\s+\w+\s*=\s*(query|mutation|action|httpAction)\s*\(/g)) {
      violations.push(`${file.path} exports a plain ${match[1]}`);
    }
    for (const match of file.source.matchAll(/(queryGeneric|mutationGeneric|actionGeneric|httpActionGeneric)\b/g)) {
      violations.push(`${file.path} uses ${match[1]}`);
    }
  }
  return violations;
}

/**
 * The files that may register a `publicQuery`: a read with no sign-in at all. Each one is reviewed to
 * return only public-suitable fields. A new file needs a reason to be added here.
 */
export const PUBLIC_QUERY_FILES = [
  "convex/trust.ts",
  // A published booking form is public by definition: its questions, the company's name and the services it lists. Nothing else.
  "convex/salesFormPages.ts",
] as const;

/** A `publicQuery` anywhere except the reviewed files is a violation. */
export function publicQueryViolations(files: GuardFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.endsWith(".test.ts") || file.path.includes("/_generated/")) continue;
    if (file.path.endsWith("lib/builders.ts") || file.path.endsWith("lib/guard.ts")) continue;
    if (!/\bpublicQuery\s*\(/.test(file.source)) continue;
    const normalized = file.path.replace(/\\/g, "/");
    if (!PUBLIC_QUERY_FILES.some((allowed) => normalized.endsWith(allowed))) violations.push(`${file.path} registers a publicQuery but is not in PUBLIC_QUERY_FILES`);
  }
  return violations;
}

/** The trust change log is append-only too: convex/lib/trust/changes.ts inserts, nothing changes a row. */
export function trustChangeLogViolations(files: GuardFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.endsWith(".test.ts") || file.path.includes("/_generated/")) continue;
    const writer = file.path.replace(/\\/g, "/").endsWith("lib/trust/changes.ts");
    if (!writer && /insert\(\s*["']trustChanges["']/.test(file.source)) violations.push(`${file.path} writes to the trust change log directly; use logTrustChange`);
    if (writer && /\.(patch|replace|delete)\(/.test(file.source)) violations.push(`${file.path} changes or removes a trust change`);
  }
  return violations;
}

/** The event log is append-only: one place inserts, nothing changes or removes a row. */
export function eventLogViolations(files: GuardFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.endsWith(".test.ts") || file.path.includes("/_generated/")) continue;
    if (!file.path.endsWith("lib/events.ts") && /insert\(\s*["']events["']/.test(file.source)) {
      violations.push(`${file.path} writes to the event log directly; use recordEvent`);
    }
    if (file.path.endsWith("lib/events.ts") && /\.(patch|replace|delete)\(/.test(file.source)) {
      violations.push(`${file.path} changes or removes an event`);
    }
    if (/Doc<"events">[^;\n]*\n?[^;\n]*\.(patch|replace|delete)\(/.test(file.source)) {
      violations.push(`${file.path} changes or removes an event`);
    }
  }
  return violations;
}
