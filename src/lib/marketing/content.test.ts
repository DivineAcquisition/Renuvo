import { describe, expect, it } from "vitest";

import { AGENT_PROFILES } from "../../../convex/lib/departments";
import { BUILT, INTEGRATION_IDS } from "../../../convex/lib/integrations";
import { AGENT_IDS as CATALOG_AGENTS, agentReleased } from "../../../convex/lib/billing/catalog";
import { AGENT_PAGE_IDS, AGENT_PAGES } from "./agent-pages";
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

  it("has a page for every agent, calling it working only when it is released, and linking only to real agent pages", () => {
    expect([...AGENT_PAGE_IDS].sort()).toEqual([...CATALOG_AGENTS].sort());
    for (const id of AGENT_PAGE_IDS) {
      const page = AGENT_PAGES[id];
      expect(page.status, id).toBe(agentReleased(id) ? "live" : "coming_soon");
      expect(page.scene.work.length, id).toBeGreaterThan(0);
      expect(page.capabilities.length, id).toBeGreaterThanOrEqual(3);
      for (const handoff of page.handoffs) expect(AGENT_PAGE_IDS, `${id} → ${handoff.agent}`).toContain(handoff.agent);
      // A coming-soon agent is never offered on a plan other than the one that will include it.
      if (page.status === "coming_soon") expect(page.plan, id).toMatch(/when it's released/);
    }
  });
});

