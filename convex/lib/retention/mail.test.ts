import { describe, expect, it } from "vitest";

import { isAutomatic, replyText } from "./mail";

describe("a customer's own words in an email", () => {
  it("drops the message being replied to, however the mail program quoted it", () => {
    expect(replyText("The oven was missed.\n\nOn Tue, Nov 17, 2026 at 9:00 AM Alpha <a@b.co> wrote:\n> How did it go?")).toBe("The oven was missed.");
    expect(replyText("Please pause us.\n\nOn Tue, Nov 17, 2026, Alpha Cleaning\n<a@b.co> wrote:\nHow did it go?")).toBe("Please pause us.");
    expect(replyText("Not happy.\r\n\r\n-----Original Message-----\r\nFrom: Alpha\r\nWe hope it went well.")).toBe("Not happy.");
    expect(replyText("See below.\n________________________________\nFrom: Alpha <a@b.co>\nSent: Tuesday\nThe shower was missed")).toBe("See below.");
    expect(replyText("> quoted line\nMy own line\n> another")).toBe("My own line");
  });

  it("drops a signature and a phone's footer, and is empty when nothing new was written", () => {
    expect(replyText("Thanks, all good.\n-- \nDana W.\n555-0100")).toBe("Thanks, all good.");
    expect(replyText("Ok\n\nSent from my iPhone")).toBe("Ok");
    expect(replyText("On Tue, Nov 17, 2026 at 9:00 AM Alpha <a@b.co> wrote:\n> The shower was missed")).toBe("");
    expect(replyText("x".repeat(5000))).toHaveLength(2000);
  });

  it("knows mail a machine sent", () => {
    expect(isAutomatic({ from: "Dana <dana@example.com>", subject: "Automatic reply: away" })).toBe(true);
    expect(isAutomatic({ from: "Dana <dana@example.com>", subject: "Out of office" })).toBe(true);
    expect(isAutomatic({ from: "Mail Delivery <mailer-daemon@example.com>", subject: "Returned" })).toBe(true);
    expect(isAutomatic({ from: "Dana <dana@example.com>", subject: "Re: Your visit" })).toBe(false);
  });
});
