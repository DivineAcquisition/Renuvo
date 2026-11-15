import { describe, expect, it, vi } from "vitest";

import { submitEarlyAccess, type Save, type SaveResult } from "./early-access";
import { EARLY_ACCESS } from "./marketing/content";

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  const all = { name: " Dana Whitfield ", email: "Dana@SparkleCo.com", company: "Sparkle Co", focus: "Dispatch", website: "", ...fields };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

const saving = (result: SaveResult) => vi.fn<NonNullable<Save>>(async () => result);

describe("early-access form", () => {
  it("reports a request as received only when it was saved", async () => {
    const save = saving({ status: "saved" });
    expect(await submitEarlyAccess(form(), "visitor", save)).toEqual({ status: "done" });
    expect(save).toHaveBeenCalledWith({ name: "Dana Whitfield", email: "dana@sparkleco.com", company: "Sparkle Co", focus: "Dispatch", visitorKey: "visitor" });
  });

  it("says requests are not open when saving is not set up", async () => {
    expect(await submitEarlyAccess(form(), "visitor", null)).toEqual({ status: "error", message: EARLY_ACCESS.errors.closed });
  });

  it("never reports success when the save fails, is limited or is refused", async () => {
    const failing = vi.fn<NonNullable<Save>>(async () => {
      throw new Error("network");
    });
    expect(await submitEarlyAccess(form(), "visitor", failing)).toEqual({ status: "error", message: EARLY_ACCESS.errors.failed });
    expect(await submitEarlyAccess(form(), "visitor", saving({ status: "limited" }))).toEqual({ status: "error", message: EARLY_ACCESS.errors.limited });
    expect(await submitEarlyAccess(form(), "visitor", saving({ status: "invalid" }))).toEqual({ status: "error", message: EARLY_ACCESS.errors.invalid });
    const odd = vi.fn(async () => ({ status: "queued" })) as unknown as NonNullable<Save>;
    expect(await submitEarlyAccess(form(), "visitor", odd)).toEqual({ status: "error", message: EARLY_ACCESS.errors.failed });
  });

  it("checks the fields before anything is sent", async () => {
    const save = saving({ status: "saved" });
    const invalid: Record<string, string>[] = [{ name: " " }, { email: "nope" }, { company: "" }, { focus: "Everything" }];
    for (const bad of invalid) {
      expect(await submitEarlyAccess(form(bad), "visitor", save)).toEqual({ status: "error", message: EARLY_ACCESS.errors.invalid });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("sends nothing for a filled honeypot", async () => {
    const save = saving({ status: "saved" });
    expect(await submitEarlyAccess(form({ website: "https://spam.example" }), "visitor", save)).toEqual({ status: "done" });
    expect(save).not.toHaveBeenCalled();
  });
});
