import { describe, expect, it } from "vitest";

import { diffCounts, diffLines } from "./diff";
import { parseInline, parseMarkdown, plainText, safeHref } from "./markdown";
import { chatFailureWords, chatStorageKey, parseStoredChat, STATE_LOOK, toolWords } from "./session";

describe("chat markdown", () => {
  it("parses the blocks answers and drafts use", () => {
    const blocks = parseMarkdown("# Agreement\n\nPrice is **$320** per *month*.\n\n- [ ] Keys\n- [x] Alarm\n\n1. First\n2. Second\n\n| Item | Cost |\n|---|---:|\n| Labor | $120 |\n\n> Note\n\n---\n\n```\ncode\n```");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list", "table", "quote", "rule", "code"]);
    const list = blocks[2] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(list.items.map((item) => item.checked)).toEqual([false, true]);
    const table = blocks[4] as Extract<(typeof blocks)[number], { kind: "table" }>;
    expect(table.align).toEqual([null, "right"]);
    expect(table.rows).toHaveLength(1);
  });

  it("never lets HTML or unsafe links through, and marks terms to confirm", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ kind: "text", text: "<script>alert(1)</script>" }]);
    expect(parseInline("[click](javascript:alert(1))").some((node) => node.kind === "link")).toBe(false);
    expect(parseInline("[ok](javascript:void)")).toEqual([{ kind: "text", text: "ok" }]);
    expect(safeHref("/app/approvals")).toBe("/app/approvals");
    expect(safeHref("//evil.example")).toBeNull();
    expect(parseInline("Price: [[TO CONFIRM: monthly price]].")).toContainEqual({ kind: "confirm", text: "monthly price" });
  });

  it("tolerates half-written text while an answer streams", () => {
    expect(() => parseMarkdown("| a | b |\n|--")).not.toThrow();
    expect(parseInline("**unfinished")).toEqual([{ kind: "text", text: "**unfinished" }]);
    expect(parseMarkdown("```\nopen fence")[0]).toMatchObject({ kind: "code", text: "open fence" });
    expect(plainText("# Title\n\n**Bold** and [site](https://x.test)")).toBe("Title\n\nBold and site (https://x.test)");
  });
});

describe("version compare", () => {
  it("shows what was added and removed between versions", () => {
    const lines = diffLines("Price: TBD\nTerm: monthly", "Price: $320\nTerm: monthly\nNotice: 48h");
    expect(lines).toEqual([
      { kind: "removed", text: "Price: TBD" },
      { kind: "added", text: "Price: $320" },
      { kind: "same", text: "Term: monthly" },
      { kind: "added", text: "Notice: 48h" },
    ]);
    expect(diffCounts(lines)).toEqual({ added: 2, removed: 1 });
  });
});

describe("chat session state", () => {
  it("remembers the open chat per person and per company, and reads bad storage safely", () => {
    expect(chatStorageKey("u1", "c1")).not.toBe(chatStorageKey("u1", "c2"));
    expect(parseStoredChat('{"conversationId":"k1234567890abc","panelOpen":true}')).toEqual({ conversationId: "k1234567890abc", panelOpen: true });
    for (const raw of [null, "", "nope", '{"conversationId":"<script>"}']) expect(parseStoredChat(raw)).toEqual({ conversationId: null, panelOpen: false });
  });

  it("words every state, never only a color", () => {
    expect(Object.values(STATE_LOOK).map((look) => look.label)).toEqual(["New", "Working", "Needs your input", "Awaiting approval", "Completed", "Failed", "Stopped"]);
    expect(toolWords("price_service", "running")).toBe("Working out the price");
    expect(toolWords("unknown_tool", "done")).toBe("unknown tool");
  });
});

describe("when chat cannot load", () => {
  it("says plainly that chat is not deployed, instead of failing the page", () => {
    const missing = new Error("[CONVEX Q(chat:recent)] [Request ID: x] Server Error\nCould not find public function for 'chat:recent'. Did you forget to run `npx convex deploy`?");
    expect(chatFailureWords(missing).title).toBe("Chat is not switched on for this workspace yet");
    expect(chatFailureWords(new Error("Network down")).title).toBe("Chat could not load");
    // Provider and server details never reach the person.
    expect(JSON.stringify(chatFailureWords(missing))).not.toMatch(/Request ID|npx/);
  });
});
