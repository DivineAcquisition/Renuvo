/**
 * The preview gallery's list: each representative email with sample data, labelled as sample wherever
 * it's shown. Used by Settings › Notifications › Email previews and by the rendering tests, so what the
 * Owner looks at is exactly what the tests check.
 */
import { applicantInvitationEmail, bookingConfirmationEmail, proposalDeliveryEmail, type CompanyBrand } from "./company";
import { agentApprovalEmail, dispatchEscalationEmail, inboxReconnectEmail, memberInvitationEmail, paymentFailureEmail, securityEmail, weeklyDigestEmail, welcomeEmail } from "./platform";
import type { Email } from "./shared";

export type PreviewKind = "platform" | "company";

export type Preview = {
  id: string;
  name: string;
  kind: PreviewKind;
  /** Who it appears to be from, as the inbox shows it. */
  from: string;
  /** What sends it and when, in a sentence. */
  when: string;
  /** The notification category, or why it has none. */
  category: string;
  render: (origin: string | null) => Email;
};

/** Sample data, fixed so previews and tests don't move. Wednesday Nov 18 2026, 9:00 AM Central. */
const NOW = Date.UTC(2026, 10, 18, 15, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/Chicago";
const COMPANY = "Sparkle & Shine Cleaning";

export const SAMPLE_BRAND: CompanyBrand = {
  name: COMPANY,
  accent: "#0E7C66",
  address: "2100 Commerce St, Dallas, TX 75201",
  phone: "(214) 555-0142",
  email: "hello@sparkleshine.example",
  website: "https://sparkleshine.example",
};

const member = (origin: string | null) => ({ origin, companyName: COMPANY, timezone: TZ, role: "owner" as const });

export const PREVIEWS: readonly Preview[] = [
  {
    id: "welcome",
    name: "Welcome",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "Once, when an Owner creates a company.",
    category: "Account (always sent)",
    render: (origin) =>
      welcomeEmail({
        ...member(origin),
        ownerName: "Maria Lopez",
        steps: [
          { label: "Company created and terms accepted", done: true },
          { label: "Add your services and prices", done: true },
          { label: "Add your cleaners", done: false },
          { label: "Connect your texting number", done: false },
          { label: "Choose what each agent may do on its own", done: false },
        ],
      }),
  },
  {
    id: "security",
    name: "Security notice",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "When access, a connected inbox, the payout account or the company's data changes.",
    category: "Security (always sent)",
    render: (origin) => securityEmail({ ...member(origin), byName: "Devon Price", at: NOW - 12 * 60_000, change: { kind: "role_changed", memberName: "Jordan Ellis", from: "Office", to: "Manager" } }),
  },
  {
    id: "approval",
    name: "Agent approval",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "When an agent set to Ask me first wants to act.",
    category: "Approvals",
    render: (origin) =>
      agentApprovalEmail({
        ...member(origin),
        agent: "sales",
        approvalId: "sample",
        summary: "Send a revised quote to the Hendersons",
        reason: "They asked for biweekly instead of weekly service. The revised quote keeps your biweekly rate for a 3-bedroom home.",
        authorizes: "Send one email to Karen Henderson with the revised quote ($168 per visit, biweekly). Nothing else changes.",
        ifWaiting: "the quote isn't sent, and Sales reminds you once more two hours before.",
        decideBy: NOW + 6 * HOUR,
        about: [
          { label: "Customer", value: "Karen Henderson" },
          { label: "Quote", value: "$168 per visit, biweekly" },
          { label: "Was", value: "$145 per visit, weekly" },
        ],
      }),
  },
  {
    id: "escalation",
    name: "Dispatch escalation",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "When a visit is at risk and Dispatch can't fix it on its own.",
    category: "Urgent operations",
    render: (origin) =>
      dispatchEscalationEmail({
        ...member(origin),
        kind: "no_check_in",
        jobId: "sample",
        service: "Standard clean · 3 bed, 2 bath",
        customerName: "Priya Raman",
        area: "Lakewood",
        startsAt: NOW - 30 * 60_000,
        cleanerName: "Ana Morales",
        tried: [
          { text: "Texted Ana at 8:35 and 8:45. No reply.", state: "failed" },
          { text: "Called Ana at 8:50. No answer.", state: "failed" },
          { text: "Asked 2 backup cleaners nearby. Waiting on answers.", state: "open" },
        ],
        need: "Decide whether to tell Priya the visit may start late, or send someone from the office.",
      }),
  },
  {
    id: "digest",
    name: "Weekly summary",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "Mondays at 7:30 AM on the company's clock, to members who keep it on.",
    category: "Weekly summary",
    render: (origin) =>
      weeklyDigestEmail({
        ...member(origin),
        memberName: "Maria Lopez",
        weekStart: NOW - 8 * DAY,
        weekEnd: NOW - 2 * DAY,
        visitsDone: 46,
        visitsCancelled: 2,
        paidCents: 812_450,
        decisionsMade: 11,
        waiting: [
          { label: "Approve a refund of $45 for Tom Becker", detail: "Asked by Customer Care · 1 day ago", path: "/app/approvals" },
          { label: "Review an offer for Luis Ortega", detail: "Recruiter · decide by Wednesday", path: "/app/approvals" },
        ],
        sections: [
          { heading: "Sales", summary: "3 new customers booked their first visit.", items: [{ label: "Quote accepted: Rivera family", detail: "$212 biweekly" }, { label: "Quote sent: Oak Lawn Dental", detail: "Weekly office clean" }], empty: "No sales activity this week." },
          { heading: "Hiring", items: [{ label: "5 new applicants for Cleaner", detail: "2 passed screening" }], empty: "No new applicants." },
          { heading: "Customer issues", items: [], empty: "No complaints or re-cleans were recorded." },
        ],
      }),
  },
  {
    id: "booking",
    name: "Booking confirmation",
    kind: "company",
    from: `"${COMPANY} via Selestial" <sparkle-shine@mail.selestial.io>`,
    when: "When a customer books, or the office confirms a booking request.",
    category: "Sent to the customer",
    render: () =>
      bookingConfirmationEmail({
        brand: SAMPLE_BRAND,
        customerName: "Priya Raman",
        service: "Deep clean · 3 bed, 2 bath",
        startsAt: NOW + 3 * DAY,
        arrivalWindowMinutes: 30,
        timezone: TZ,
        address: "418 Gaston Ave, Dallas, TX 75214",
        lines: [
          { label: "Deep clean", amountCents: 28_500 },
          { label: "Inside the oven", amountCents: 3_500 },
        ],
        totalCents: 32_000,
        paidCents: 5_000,
        manageUrl: "https://link.selestial.io/b/sample",
        policy: "You can reschedule or cancel for free until 24 hours before your visit.",
        fromName: "Maria at Sparkle & Shine",
      }),
  },
  {
    id: "proposal",
    name: "Proposal delivery",
    kind: "company",
    from: `"${COMPANY} via Selestial" <sparkle-shine@mail.selestial.io>`,
    when: "When the office (or Sales, with approval) sends a proposal.",
    category: "Sent to the customer",
    render: () =>
      proposalDeliveryEmail({
        brand: SAMPLE_BRAND,
        recipientName: "Dr. Alan Kim",
        proposalTitle: "Office cleaning for Oak Lawn Dental",
        preparedBy: "Devon Price",
        lines: [
          { label: "Office clean, 2,400 sq ft", amountCents: 32_000, cadence: "weekly" },
          { label: "Window cleaning", amountCents: 18_000, cadence: "quarterly" },
        ],
        totalCents: 32_000,
        totalLabel: "Weekly",
        validUntil: NOW + 14 * DAY,
        timezone: TZ,
        reviewUrl: "https://link.selestial.io/p/sample",
      }),
  },
  {
    id: "applicant",
    name: "Applicant invitation",
    kind: "company",
    from: `"${COMPANY} Hiring Team via Selestial" <sparkle-shine@mail.selestial.io>`,
    when: "When Recruiter (or the office) invites an applicant to the next step.",
    category: "Sent to the applicant",
    render: () =>
      applicantInvitationEmail({
        brand: SAMPLE_BRAND,
        applicantName: "Luis Ortega",
        role: "Residential Cleaner",
        step: "screening",
        minutes: 8,
        timezone: TZ,
        url: "https://link.selestial.io/a/sample",
        expiresAt: NOW + 7 * DAY,
        whatToBring: ["Your weekly availability", "Whether you have a car", "Any cleaning experience"],
      }),
  },
  {
    id: "payment-failure",
    name: "Payment failure",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "When the Selestial plan payment is declined.",
    category: "Account (always sent)",
    render: (origin) => paymentFailureEmail({ ...member(origin), planName: "Operate", amountDueCents: 29_900, failedAt: NOW - 2 * HOUR, cardEnding: "4242", pausesAt: NOW + 7 * DAY }),
  },
  {
    id: "inbox-reconnect",
    name: "Gmail reconnection",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "When a connected inbox stops working.",
    category: "Account (always sent)",
    render: (origin) =>
      inboxReconnectEmail({ ...member(origin), address: "hiring@sparkleshine.example", purposes: ["Hiring", "Sales"], agents: ["recruiter", "sales"], since: NOW - 5 * HOUR, reason: "expired", held: 3 }),
  },
  {
    id: "invitation",
    name: "Team invitation",
    kind: "platform",
    from: "Selestial <notify@notify.selestial.io>",
    when: "When the Owner invites someone to the company.",
    category: "Sent to the invitee",
    render: (origin) => memberInvitationEmail({ origin, companyName: COMPANY, inviterName: "Maria Lopez", role: "office", url: "https://app.selestial.io/invite/sample", expiresAt: NOW + 7 * DAY, timezone: TZ }),
  },
];

export const previewById = (id: string) => PREVIEWS.find((p) => p.id === id);
