import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyProvider } from "@/components/app/company";

const data: Record<string, unknown> = {};
let search = "";
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => (args === "skip" ? undefined : data[getFunctionName(ref)]),
  useMutation: () => async () => undefined,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/agents/sales", useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/components/app/chat/chat-context", () => ({ useChat: () => ({ openPanel: () => undefined }), useOfferChatContext: () => undefined }));
vi.mock("@/components/app/use-now", () => ({ useNow: () => Date.UTC(2026, 10, 16, 15) }));

const { SalesOverviewScreen } = await import("./overview");
const { SalesPipelineScreen } = await import("./pipeline");
const { SalesConversationsScreen } = await import("./conversations");
const { SalesQuotesScreen } = await import("./quotes");
const { SalesFollowUpsScreen } = await import("./follow-ups");
const { SalesFormsScreen } = await import("./forms");
const { SalesPlaybookScreen } = await import("./playbook");

const T = Date.UTC(2026, 10, 16, 15);
const HOUR = 3_600_000;
const SCREENS = { overview: SalesOverviewScreen, pipeline: SalesPipelineScreen, conversations: SalesConversationsScreen, quotes: SalesQuotesScreen, followUps: SalesFollowUpsScreen, forms: SalesFormsScreen, playbook: SalesPlaybookScreen };

const render = (Screen: () => React.ReactNode, role: "owner" | "manager" | "office" = "owner") =>
  renderToStaticMarkup(
    <CompanyProvider company={{ companyId: "c1" as never, name: "Brightside Cleaning", timezone: "America/Chicago", role }}>
      <Screen />
    </CompanyProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const card = (id: string, customer: string, stage: string, extra: Record<string, unknown> = {}) => ({
  opportunityId: id,
  customerId: `cu${id}`,
  customer,
  kind: "residential",
  kindWords: "Home",
  service: "Standard clean",
  stage,
  stageWords: { new: "New", qualifying: "Qualifying", quote_sent: "Quote sent", booking_pending: "Booking pending", won: "Won" }[stage] ?? stage,
  stageAt: T - HOUR,
  attention: "none",
  attentionWords: "",
  nextAction: { what: "Waiting for the customer to accept, decline or ask about the quote", by: "customer", dueAt: T + 48 * HOUR },
  quote: null,
  source: "form",
  sourceWords: "Booking form",
  channel: "sms",
  receivedAt: T - 3 * HOUR,
  lastInboundAt: T - 3 * HOUR,
  lastOutboundAt: T - 2 * HOUR,
  takenOver: false,
  working: false,
  followUpAt: null,
  deferredUntil: null,
  lostReason: null,
  jobId: null,
  updatedAt: T - HOUR,
  ...extra,
});

const overview = (extra: Record<string, unknown> = {}) => ({
  built: true,
  paused: false,
  state: "waiting",
  working: 0,
  reader: "rules",
  firstBatch: { decided: true, at: T - 24 * HOUR },
  counts: { newInquiries: 0, awaitingDetails: 0, quotesForReview: 0, quotesWithCustomer: 1, bookingPending: 0, followUpsDue: 1, needsYou: 0, open: 1 },
  attention: [],
  recentBookings: [],
  recentActions: [],
  measures: { days: 30, inquiries: 4, responded: 3, medianResponseMinutes: 2, qualified: 3, quotesSent: 2, quotesAccepted: 1, bookings: 1, quotedValueCents: 41500, bookedValueCents: 18500, collectedDepositsCents: 0, lost: [{ reason: "price", count: 1 }], withPersonInvolved: 1, messagesSent: 6, deliveryFailures: 0 },
  ...extra,
});

const readiness = [
  { key: "services", label: "Published services", ok: true, detail: "1 published.", href: "/app/services", action: "Open Services & Pricing" },
  { key: "texting", label: "Text messages", ok: false, detail: "Texting isn't connected for Selestial yet.", href: "/app/settings/compliance", action: "Open texting setup" },
];

beforeEach(() => {
  for (const key of Object.keys(data)) delete data[key];
  search = "";
});

describe("the Sales screens", () => {
  it("show that they are loading, and never an empty result, before the record arrives", () => {
    for (const [name, Screen] of Object.entries(SCREENS)) {
      const markup = render(Screen);
      expect(markup, name).toContain('aria-busy="true"');
      expect(text(markup), name).not.toMatch(/No inquiry yet|No quote yet|No conversation yet|No follow-up is planned/);
    }
  });

  it("say plainly when there is nothing yet, and how something gets there", () => {
    data["sales:pipeline"] = { cards: [], stages: [] };
    data["salesConversations:list"] = [];
    data["salesQuotes:list"] = [];
    data["salesFollowUps:list"] = { scheduled: [], recent: [] };
    data["salesForms:list"] = [];
    data["salesForms:templates"] = [{ kind: "residential", name: "Home cleaning inquiry", blurb: "Size and how often.", questions: 9 }];
    expect(text(render(SalesPipelineScreen))).toContain("No inquiry yet");
    expect(text(render(SalesQuotesScreen))).toContain("No quote yet");
    expect(text(render(SalesFollowUpsScreen))).toContain("No follow-up is planned");
    expect(text(render(SalesFormsScreen))).toContain("No form yet");
    const conversations = text(render(SalesConversationsScreen));
    expect(conversations).toContain("No conversation yet");
    // Texts and emails only: the page never offers or implies a call.
    expect(conversations).not.toMatch(/\bcalls?\b|voice/i);
  });

  it("shows Sales as working only while a run is in progress, and as paused when it is paused", () => {
    data["sales:readiness"] = readiness;
    data["salesActions:waiting"] = { firstBatch: { decided: true, at: T }, pending: [], canDecide: true, ownerOnlyBatch: false };
    data["sales:overview"] = overview();
    const idle = render(SalesOverviewScreen);
    expect(idle).not.toContain("agent-shimmer");
    expect(idle).not.toContain("animate-spin");
    expect(text(idle)).toContain("Watching 1 open opportunity");

    data["sales:overview"] = overview({ state: "working", working: 2 });
    const busy = render(SalesOverviewScreen);
    expect(busy).toContain("agent-shimmer");
    expect(text(busy)).toContain("Working on 2 opportunities right now");

    data["sales:overview"] = overview({ state: "paused", paused: true, working: 0 });
    const paused = render(SalesOverviewScreen);
    expect(paused).not.toContain("agent-shimmer");
    expect(text(paused)).toContain("Sales is paused.");
  });

  it("names what is not ready and never calls quoted value revenue", () => {
    data["sales:readiness"] = readiness;
    data["salesActions:waiting"] = { firstBatch: { decided: true, at: T }, pending: [], canDecide: true, ownerOnlyBatch: false };
    data["sales:overview"] = overview();
    const words = text(render(SalesOverviewScreen));
    expect(words).toContain("Text messages: not ready");
    expect(words).toContain("Texting isn't connected for Selestial yet.".replace("'", "&#x27;"));
    expect(words).toContain("Quoted value");
    expect(words).toContain("Booked value");
    expect(words).toContain("Deposits received");
    expect(words).not.toMatch(/revenue/i);
    // Each rate says what it is a share of.
    expect(words).toContain("Of the 4 inquiries received in this period");
    // Money received is the Owner's to see.
    data["sales:overview"] = overview({ measures: { ...overview().measures, collectedDepositsCents: null } });
    expect(text(render(SalesOverviewScreen, "office"))).toContain("Owner only");
  });

  it("puts each card in its stage with who acts next, and keeps closed work off the board unless asked", () => {
    data["sales:pipeline"] = {
      cards: [card("o1", "Maria Lopez", "quote_sent", { quote: { quoteId: "q1", number: 1001, status: "sent", totalCents: 18500, per: "visit" } }), card("o2", "Dana Cole", "new", { attention: "needs_review", attentionWords: "Needs your review", nextAction: { what: "Answer a question Sales has no approved answer for", by: "owner", dueAt: T + 4 * HOUR } })],
      stages: ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending", "won", "deferred", "closed_lost"].map((stage) => ({ stage, label: stage === "closed_lost" ? "Closed lost" : stage.replace("_", " "), entry: "", count: 0, valueCents: 0 })),
    };
    const board = text(render(SalesPipelineScreen));
    expect(board).toContain("Maria Lopez");
    expect(board).toContain("$185 quoted");
    expect(board).toContain("Needs your review");
    expect(board).toContain("You · Answer a question Sales has no approved answer for");
    expect(board).not.toContain("Closed lost");
    search = "closed=1";
    expect(text(render(SalesPipelineScreen))).toContain("Closed lost");
    // Office works the pipeline but does not import lists.
    search = "";
    expect(text(render(SalesPipelineScreen, "owner"))).toContain("Import prospects");
    expect(text(render(SalesPipelineScreen, "office"))).not.toContain("Import prospects");
  });
});
