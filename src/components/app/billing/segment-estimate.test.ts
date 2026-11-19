import { describe, expect, it } from "vitest";

import { segmentEstimate } from "./segment-estimate";

describe("the segment estimate under a text", () => {
  it("says segments and cost in the exact words owners see", () => {
    expect(segmentEstimate("Hi Dana, see you Tuesday at 9.").words).toBe("This message uses 1 SMS segment. Estimated cost: $0.025.");
    expect(segmentEstimate("a".repeat(161)).words).toBe("This message uses 2 SMS segments. Estimated cost: $0.05.");
  });

  it("counts emoji and curly quotes the way carriers do, and says when plain punctuation would cost less", () => {
    const curly = `Don’t forget: we’ll arrive at 9. ${"x".repeat(50)}`;
    expect(segmentEstimate(curly)).toMatchObject({ encoding: "ucs2", segments: 2, fixable: true });
    // An agent's text is sent with plain punctuation, so it costs one segment.
    expect(segmentEstimate(curly, { agent: true })).toMatchObject({ encoding: "gsm7", segments: 1 });
    expect(segmentEstimate("Thanks! 😊")).toMatchObject({ encoding: "ucs2", segments: 1, fixable: false });
  });

  it("refuses more than ten segments", () => {
    expect(segmentEstimate("a".repeat(153 * 10 + 1))).toMatchObject({ segments: 11, tooLong: true });
  });
});
