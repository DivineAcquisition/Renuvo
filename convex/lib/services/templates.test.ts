import { describe, expect, it } from "vitest";

import { checkSpec, quote, sumOfLines } from "./engine";
import { CATEGORIES } from "./spec";
import { keptTemplateAmounts, sampleInputs, normalizeSpec } from "./store";
import { TEMPLATES } from "./templates";

const answer = (kind: string, options: string[]) => (kind === "number" ? 1 : kind === "yes_no" ? "no" : kind === "choice" ? options[0] : "Front door code");

describe("templates", () => {
  it("cover every category with the examples the owner asked for", () => {
    for (const category of CATEGORIES) expect(TEMPLATES.filter((t) => t.category === category).length, category).toBeGreaterThanOrEqual(3);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  for (const template of TEMPLATES) {
    it(`${template.id} is a valid, priceable structure that cannot be published unconfirmed`, () => {
      // It survives the same checks a saved draft does.
      expect(normalizeSpec(template.spec).name).toBe(template.name);
      expect(template.methods[0]).toBe(template.spec.pricing.method);
      expect(template.spec.illustrative).toBe(true);
      const blockers = checkSpec(template.spec).filter((p) => p.severity === "blocker");
      expect(blockers.map((p) => p.code).every((code) => code === "illustrative" || code === "unconfirmed"), JSON.stringify(blockers)).toBe(true);
      // Specialized work never implies the company holds what it needs.
      if (template.category === "specialty" && template.id !== "sp-event") expect(template.spec.requirements.length).toBeGreaterThan(0);
      for (const requirement of template.spec.requirements) expect(requirement.confirmed).toBe(false);
      // With its questions answered, it gives a price or says a walkthrough is needed: never "incomplete".
      const answers = Object.fromEntries(template.spec.questions.filter((q) => q.required).map((q) => [q.id, answer(q.kind, q.options)]));
      for (const { input } of sampleInputs(template.spec)) {
        const result = quote(template.spec, { ...input, answers, ...(template.spec.str?.enabled ? { beds: 2 } : {}) });
        expect(result.outcome, `${template.id} ${JSON.stringify(result.missing)}`).not.toBe("incomplete");
        if (result.outcome !== "walkthrough") expect(sumOfLines(result.lines)).toBe(result.totalCents);
      }
    });
  }

  it("never charges for the extras a move-out clean already includes", () => {
    const move = TEMPLATES.find((t) => t.id === "res-move")!;
    const result = quote(move.spec, { area: 1500, addOns: move.spec.addOns.map((a) => ({ id: a.id, quantity: 1 })), answers: { "home-size-sq-ft": 1500, "will-the-home-be-empty": "yes" } });
    expect(result.extras.every((e) => e.included && e.amountCents === 0)).toBe(true);
    expect(result.totalCents).toBe(35000);
  });

  it("names the prices still exactly the template's, and drops each one the owner changes", () => {
    const standard = TEMPLATES.find((t) => t.id === "res-standard")!.spec;
    const kept = keptTemplateAmounts(standard, standard);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((k) => k.value.length > 0 && (k.step === "pricing" || k.step === "extras"))).toBe(true);
    const first = kept.find((k) => k.step === "pricing")!;
    const key = first.key.replace("pricing.", "");
    const changed = { ...standard, pricing: { ...standard.pricing, [key]: (standard.pricing as unknown as Record<string, number>)[key] + 500 } } as typeof standard;
    expect(keptTemplateAmounts(changed, standard).map((k) => k.key)).not.toContain(first.key);
    // Another method entirely shares none of the template's pricing amounts.
    expect(keptTemplateAmounts({ ...standard, pricing: { method: "fixed", amountCents: 15000, laborMinutes: 120 } }, standard).some((k) => k.step === "pricing")).toBe(false);
  });

  it("never lists an extra the service already includes, since it is never charged", () => {
    const move = TEMPLATES.find((t) => t.id === "res-move")!.spec;
    const kept = keptTemplateAmounts(move, move);
    for (const addOn of move.addOns.filter((a) => a.coversItemId && move.included.some((i) => i.id === a.coversItemId))) expect(kept.map((k) => k.key)).not.toContain(`addOns.${addOn.id}`);
  });
});
