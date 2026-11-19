import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CompanyProvider } from "@/components/app/company";
import { COMING_SOON } from "@/lib/app/coming-soon";
import { AGENTS } from "@/lib/app/navigation";

import { PLANNED_AGENT_IDS } from "../../../../convex/lib/agentAccess/schema";
import { AGENT_CATALOG } from "../../../../convex/lib/billing/catalog";

let data: Record<string, unknown> = {};
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => (args === "skip" ? undefined : data[getFunctionName(ref)]),
  useMutation: () => async () => undefined,
}));

const { ComingSoonAgentPage } = await import("./agent-page");

const render = (id: keyof typeof COMING_SOON) =>
  renderToStaticMarkup(
    <CompanyProvider company={{ companyId: "c1" as never, name: "Alpha", timezone: "UTC", role: "office" }}>
      <ComingSoonAgentPage agent={COMING_SOON[id]} />
    </CompanyProvider>,
  );

describe("coming-soon agent pages", () => {
  it("cover exactly the agents not built yet, which the backend accepts requests for, on the plan the catalog says", () => {
    const planned = AGENTS.filter((agent) => agent.workflow === "planned").map((agent) => agent.id).sort();
    expect(Object.keys(COMING_SOON).sort()).toEqual(planned);
    expect([...PLANNED_AGENT_IDS].sort()).toEqual(planned);
    for (const agent of Object.values(COMING_SOON)) {
      const nav = AGENTS.find((row) => row.id === agent.id)!;
      // Each capability lives under a tab the sidebar already shows for that agent.
      for (const capability of agent.capabilities) expect(nav.tabs.map((tab) => tab.label), `${agent.id}: ${capability.tab}`).toContain(capability.tab);
      expect(AGENT_CATALOG[agent.id].plans).toEqual(["expand"]);
      expect(agent.plan).toMatch(/Expand plan/);
    }
  });

  it("shows what the agent will do, the worked example, and a request for early access that turns nothing on", () => {
    data = { "agentAccess:mine": { requested: false, mine: false, people: 0, firstAt: null, status: null } };
    const html = render("quality");
    for (const text of ["Coming soon", "Quality", "Watch it work", "An example. Names and numbers are made up.", "Visit finished at 12 Elm St", "One item flagged", "What Quality will do", "Completion Review", "Want Quality sooner?", "Asking turns nothing on", "Request early access"]) expect(html, text).toContain(text);
    expect(html).not.toContain("Available today");
  });

  it("says when you've asked, and points Marketing to what works today", () => {
    data = { "agentAccess:mine": { requested: true, mine: true, people: 2, names: ["Maria", "Sam"], firstAt: 1, status: "requested" } };
    const html = render("marketing");
    expect(html).toContain("on the early access list");
    expect(html).toContain("2 people at your company have asked for early access.");
    expect(html).toContain("Available today");
    expect(html).toContain('href="/app/agents/marketing/content-creative"');
  });
});
