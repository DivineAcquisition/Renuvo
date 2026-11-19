import { describe, expect, it } from "vitest";

import { AGENT_PROFILES } from "../../../convex/lib/departments";
import { BUILT, INTEGRATION_IDS } from "../../../convex/lib/integrations";
import { AGENT_STATUS, AGENTS, INTEGRATIONS, PRICING } from "./content";

/** The public site never claims more than the product does. */
describe("public site claims", () => {
  it("calls an agent working only when the product has built it", () => {
    for (const agent of AGENTS) expect(AGENT_STATUS[agent.id].live, agent.id).toBe(AGENT_PROFILES[agent.id].built);
  });

  it("calls a connection live only when the product has built it", () => {
    const known = new Set<string>(INTEGRATION_IDS);
    for (const group of INTEGRATIONS.groups)
      for (const item of group.items) {
        if (item.catalogId) expect(known.has(item.catalogId), item.name).toBe(true);
        expect(item.live, item.name).toBe(item.catalogId !== null && (BUILT as readonly string[]).includes(item.catalogId));
      }
  });

  it("lists an agent under Not released yet exactly when it is not built", () => {
    const later = PRICING.plans.flatMap((plan) => plan.later).join(" ");
    for (const agent of AGENTS) expect(later.includes(agent.name), agent.id).toBe(!AGENT_PROFILES[agent.id].built);
  });
});
