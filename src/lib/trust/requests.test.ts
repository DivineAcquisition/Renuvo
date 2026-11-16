import { describe, expect, it, vi } from "vitest";

import { submitTrustRequest } from "./requests";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("public request forms", () => {
  it("says received only when the record saved it, and sends only this kind's fields", async () => {
    const save = vi.fn().mockResolvedValue({ status: "saved", reference: "PR-7K2M9Q" });
    const result = await submitTrustRequest("vulnerability", form({ email: " r@example.com ", affected: "/x", details: "y", businessName: "ignored", marketing: "yes" }), "visitor", save);
    expect(result).toEqual({ status: "saved", reference: "PR-7K2M9Q" });
    expect(save).toHaveBeenCalledWith({ kind: "vulnerability", email: "r@example.com", affected: "/x", details: "y", visitorKey: "visitor" });
  });

  it("keeps what was typed when the record refuses a field", async () => {
    const save = vi.fn().mockResolvedValue({ status: "invalid", field: "details", message: "Details is needed." });
    const result = await submitTrustRequest("privacy", form({ email: "a@example.com", subtype: "access" }), "v", save);
    expect(result).toEqual({ status: "invalid", field: "details", message: "Details is needed.", values: { email: "a@example.com", subtype: "access" } });
  });

  it("never claims success when saving is not set up or fails", async () => {
    expect((await submitTrustRequest("privacy", form({ email: "a@example.com" }), "v", null)).status).toBe("failed");
    const broken = vi.fn().mockRejectedValue(new Error("down"));
    expect((await submitTrustRequest("security_review", form({ email: "a@example.com" }), "v", broken)).status).toBe("failed");
  });

  it("asks for an email before sending anything", async () => {
    const save = vi.fn();
    const result = await submitTrustRequest("privacy", form({ details: "x" }), "v", save);
    expect(result.status).toBe("invalid");
    expect(save).not.toHaveBeenCalled();
  });

  it("passes the bot field through so the record can drop it", async () => {
    const save = vi.fn().mockResolvedValue({ status: "saved", reference: "X" });
    await submitTrustRequest("vulnerability", form({ email: "a@example.com", website: "spam.example" }), "v", save);
    expect(save.mock.calls[0][0].website).toBe("spam.example");
  });

  it("reports a rate limit plainly", async () => {
    const save = vi.fn().mockResolvedValue({ status: "limited" });
    expect((await submitTrustRequest("privacy", form({ email: "a@example.com" }), "v", save)).status).toBe("limited");
  });
});
