/**
 * One description of a tool's input that serves twice: as the JSON Schema the model is given, and as
 * the check every input passes before a tool runs. A model's input is untrusted output: it is checked
 * here whatever the model was told.
 */

export type Field =
  | { type: "string"; description?: string; optional?: boolean; max?: number; enum?: readonly string[] }
  | { type: "number"; description?: string; optional?: boolean; min?: number; max?: number; integer?: boolean }
  | { type: "boolean"; description?: string; optional?: boolean }
  | { type: "array"; description?: string; optional?: boolean; items: Field; maxItems: number; minItems?: number }
  | { type: "object"; description?: string; optional?: boolean; properties: Record<string, Field> };

export class InputError extends Error {}

export function jsonSchema(field: Field): Record<string, unknown> {
  const base: Record<string, unknown> = field.description ? { description: field.description } : {};
  switch (field.type) {
    case "string":
      return { ...base, type: "string", ...(field.enum ? { enum: [...field.enum] } : {}) };
    case "number":
      return { ...base, type: field.integer ? "integer" : "number" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "array":
      return { ...base, type: "array", items: jsonSchema(field.items) };
    case "object":
      return {
        ...base,
        type: "object",
        properties: Object.fromEntries(Object.entries(field.properties).map(([key, value]) => [key, jsonSchema(value)])),
        required: Object.entries(field.properties)
          .filter(([, value]) => !value.optional)
          .map(([key]) => key),
        additionalProperties: false,
      };
  }
}

export function check(field: Field, value: unknown, path = "input"): unknown {
  if (value === undefined || value === null) {
    if (field.optional) return undefined;
    throw new InputError(`${path} is required.`);
  }
  switch (field.type) {
    case "string": {
      if (typeof value !== "string") throw new InputError(`${path} must be text.`);
      const trimmed = value.trim();
      if (!trimmed && !field.optional) throw new InputError(`${path} is required.`);
      if (trimmed.length > (field.max ?? 2000)) throw new InputError(`${path} is too long.`);
      if (field.enum && !field.enum.includes(trimmed)) throw new InputError(`${path} must be one of: ${field.enum.join(", ")}.`);
      return trimmed || undefined;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new InputError(`${path} must be a number.`);
      if (field.integer && !Number.isInteger(value)) throw new InputError(`${path} must be a whole number.`);
      if (field.min !== undefined && value < field.min) throw new InputError(`${path} must be at least ${field.min}.`);
      if (field.max !== undefined && value > field.max) throw new InputError(`${path} must be at most ${field.max}.`);
      return value;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new InputError(`${path} must be true or false.`);
      return value;
    case "array": {
      if (!Array.isArray(value)) throw new InputError(`${path} must be a list.`);
      if (value.length > field.maxItems) throw new InputError(`${path} has too many entries.`);
      if (value.length < (field.minItems ?? 0)) throw new InputError(`${path} needs at least ${field.minItems} entries.`);
      return value.map((item, index) => check(field.items, item, `${path}[${index}]`));
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) throw new InputError(`${path} must be an object.`);
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) if (!(key in field.properties)) throw new InputError(`${path}.${key} is not expected.`);
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(field.properties)) {
        const checked = check(inner, record[key], `${path}.${key}`);
        if (checked !== undefined) out[key] = checked;
      }
      return out;
    }
  }
}

/** A stable short hash of a value, for idempotency keys and approval bindings. Not a security function. */
export function stableHash(value: unknown): string {
  const text = canonical(value);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
}
