import { describe, expect, it } from "vitest";

import { PERSON_ONLY } from "../../../../convex/lib/permissionCatalog";
import { textFor } from "./index";

const words = (kind: "security" | "terms") => JSON.stringify(textFor(kind).sections).toLowerCase();

describe("the actions that always need a person", () => {
  it("are listed in the Security overview and the Terms exactly as the code enforces them", () => {
    for (const row of PERSON_ONLY) {
      const label = row.label.toLowerCase();
      expect(words("security"), row.key).toContain(label);
      expect(words("terms"), row.key).toContain(label);
    }
  });
});
