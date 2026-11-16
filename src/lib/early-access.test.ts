import { describe, expect, it, vi } from "vitest";

import { submitEarlyAccess, type Save, type SaveResult } from "./early-access";
import { EARLY_ACCESS } from "./marketing/content";
import { ASSESSMENT, ASSESSMENT_QUESTIONS } from "../../convex/lib/assessment";

const answers = { role: "owner", businessType: "combination", cleaners: "15_29", monthlyCleans: "150_299", bookingTool: "manual", help: "dispatch", openTo: "broader_move" };

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  const all = { name: " Dana Whitfield ", email: "Dana@SparkleCo.com", company: "Sparkle Co", phone: "(512) 555-0142", businessPage: "sparkleco.com", ...answers, fax: "", ...fields };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

const saving = (result: SaveResult) => vi.fn<NonNullable<Save>>(async () => result);

describe("early-access form", () => {
  it("reports a request as received only when it was saved", async () => {
    const save = saving({ status: "saved" });
    expect(await submitEarlyAccess(form(), "visitor", save)).toEqual({ status: "done" });
    expect(save).toHaveBeenCalledWith({ ...answers, name: "Dana Whitfield", email: "dana@sparkleco.com", company: "Sparkle Co", phone: "(512) 555-0142", website: "sparkleco.com", smsConsent: false, visitorKey: "visitor" });
  });

  it("shows exactly the questions and answers that can be stored", () => {
    expect(EARLY_ACCESS.questions.map((question) => question.name)).toEqual(ASSESSMENT_QUESTIONS);
    for (const question of EARLY_ACCESS.questions) expect(question.options.map(([value]) => value)).toEqual([...ASSESSMENT[question.name]]);
    expect(EARLY_ACCESS.submit).toBe("Request My Operations Assessment");
  });

  it("shows four questions as dropdowns, and sends consent to texts only when the box was ticked", async () => {
    expect(EARLY_ACCESS.dropdowns.every((name) => (ASSESSMENT_QUESTIONS as readonly string[]).includes(name))).toBe(true);
    const save = saving({ status: "saved" });
    await submitEarlyAccess(form({ smsConsent: "yes" }), "visitor", save);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ phone: "(512) 555-0142", website: "sparkleco.com", smsConsent: true }));
    await submitEarlyAccess(form(), "visitor", save);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ smsConsent: false }));
  });

  it("checks the fields before anything is sent", async () => {
    const save = saving({ status: "saved" });
    const invalid: Record<string, string>[] = [{ name: " " }, { email: "nope" }, { company: "" }, { help: "everything" }, { role: "" }, { cleaners: "5–14" }, { phone: "abc" }, { phone: "" }, { businessPage: "not a site" }, { businessPage: "" }];
    for (const bad of invalid) {
      expect(await submitEarlyAccess(form(bad), "visitor", save)).toEqual({ status: "error", message: EARLY_ACCESS.errors.invalid });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("sends nothing for a filled honeypot", async () => {
    const save = saving({ status: "saved" });
    expect(await submitEarlyAccess(form({ fax: "https://spam.example" }), "visitor", save)).toEqual({ status: "done" });
    expect(save).not.toHaveBeenCalled();
  });
});
