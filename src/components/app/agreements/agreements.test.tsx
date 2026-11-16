import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompanyProvider, type Role } from "@/components/app/company";
import { AGREEMENT_TABS, splitConfirm, WORKFLOW } from "@/lib/app/agreements";

import type { Id } from "../../../../convex/_generated/dataModel";

const calls: { name: string; args: unknown }[] = [];
let data: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    return args === "skip" ? undefined : data[name];
  },
  useMutation: () => async () => undefined,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/agreements/all", useRouter: () => ({ push: () => undefined, replace: () => undefined }), useSearchParams: () => new URLSearchParams("") }));

const { AgreementsOverview } = await import("@/components/app/agreements/overview");
const { AgreementsLayout } = await import("@/components/app/agreements/layout");
const { DocumentView } = await import("@/components/app/agreements/document");
const { AgreementRow, ReadinessBadge, WorkflowBadge } = await import("@/components/app/agreements/shared");
const { AgreementsForRecord } = await import("@/components/app/agreements/record");

const companyId = "company1" as Id<"companies">;
const as = (role: Role, node: React.ReactNode) => renderToStaticMarkup(<CompanyProvider company={{ companyId, name: "Elm", timezone: "America/Chicago", role }}>{node}</CompanyProvider>);

const row = { id: "ag1", title: "Dana's weekly clean", typeLabel: "Recurring Residential Cleaning", workflow: "sent", lifecycle: "none", access: "company", effectiveOn: "2027-03-15", renewalOn: null, expiresOn: null, parties: [{ role: "company", name: "Elm" }, { role: "customer", name: "Dana Whitfield" }], version: 3, provenance: "unsigned", archived: false };
const overview = (counts: Partial<Record<string, number>> = {}, total = 3) => ({
  today: "2027-03-01",
  total,
  archived: 0,
  scanned: total,
  capped: false,
  canDraft: true,
  signing: { configured: false, provider: null, testMode: false, why: "No e-signature provider is connected. You can draft, approve, export a PDF, and upload a document signed elsewhere." },
  views: ["drafts", "review", "signatures", "failed", "upcoming", "renewals", "missing"].map((view) => ({ view, label: view, count: counts[view] ?? 0, items: counts[view] ? [row] : [] })),
});

beforeEach(() => {
  calls.length = 0;
  data = {};
});

describe("the Agreements workspace", () => {
  it("has the six sections in order, and the three ways to start", () => {
    expect(AGREEMENT_TABS.map((t) => t.label)).toEqual(["Overview", "All Agreements", "Templates", "Awaiting Signatures", "Renewals & Changes", "Archive"]);
    data["companyAgreements:catalog"] = { capabilities: ["view", "draft"] };
    const html = as("office", <AgreementsLayout>x</AgreementsLayout>);
    for (const label of ["Build with Selestial", "Use a Template", "Upload Agreement", "Overview", "All Agreements", "Templates", "Awaiting Signatures", "Renewals &amp; Changes", "Archive"]) expect(html, label).toContain(label);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("/app/agreements/new?mode=upload");
  });

  it("hides the ways to start from a role that cannot draft", () => {
    data["companyAgreements:catalog"] = { capabilities: ["view"] };
    expect(as("office", <AgreementsLayout>x</AgreementsLayout>)).not.toContain("Build with Selestial");
  });

  it("shows a useful empty state, and says plainly that signing is not connected", () => {
    data["companyAgreements:overview"] = overview({}, 0);
    const html = as("owner", <AgreementsOverview />);
    expect(html).toContain("No agreements yet");
    expect(html).toContain("Build with Selestial");
    expect(html).toContain("Upload one you already have");
    expect(html).toContain("No e-signature provider is connected");
  });

  it("links every count to the records behind it", () => {
    data["companyAgreements:overview"] = overview({ drafts: 2, signatures: 1, renewals: 1, missing: 2 });
    const html = as("owner", <AgreementsOverview />);
    expect(html).toContain('href="/app/agreements/all?view=drafts"');
    expect(html).toContain('href="/app/agreements/awaiting-signatures?view=signatures"');
    expect(html).toContain('href="/app/agreements/awaiting-signatures?view=failed"');
    expect(html).toContain('href="/app/agreements/renewals?view=renewals"');
    expect(html).toContain('href="/app/agreements/all?view=missing"');
    expect(html).toContain("Still being written.");
    expect(html).toContain("Dana&#x27;s weekly clean");
  });

  it("marks every missing fact in a document where it is, and does not run the text as markup", () => {
    const html = renderToStaticMarkup(<DocumentView markdown={"# Title\n\n## 1. Price\n\nThe price is [[TO CONFIRM: Price per visit]] <script>alert(1)</script> a month."} />);
    expect(html).toContain("<mark");
    expect(html).toContain("Price per visit");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(splitConfirm("a [[TO CONFIRM: x]] b").map((p) => p.missing)).toEqual([false, true, false]);
  });

  it("words each state without overclaiming", () => {
    expect(WORKFLOW.sent.meaning).toMatch(/Not delivered or signed until it reports so/);
    expect(WORKFLOW.partially_signed.label).toBe("Partially signed");
    expect(WORKFLOW.delivery_failed.tone).toBe("error");
    expect(renderToStaticMarkup(<WorkflowBadge workflow="signed" />)).toContain("Signed");
    expect(renderToStaticMarkup(<ReadinessBadge readiness="specialist_review" />)).toContain("Needs specialist review");
    expect(renderToStaticMarkup(<ReadinessBadge readiness="template" />).replace(/<[^>]*>/g, "")).toBe("Available template");
    const html = renderToStaticMarkup(<ul><AgreementRow row={row} /></ul>);
    expect(html).toContain('href="/app/agreements/ag1"');
    expect(html).toContain("Sent for signature");
    expect(html).toContain("Dana Whitfield");
  });

  it("shows only what the server returns for a record, and nothing about what it hides", () => {
    data["companyAgreements:forRecord"] = [];
    const html = as("office", <AgreementsForRecord table="cleaners" id="c1" />);
    expect(html).toContain("None you can see.");
    expect(html).not.toMatch(/hidden|restricted|\d+ more/i);
    data["companyAgreements:forRecord"] = [{ ...row, lifecycle: "in_force", workflow: "signed" }];
    expect(as("owner", <AgreementsForRecord table="customers" id="c1" />)).toContain("/app/agreements/ag1");
  });
});
