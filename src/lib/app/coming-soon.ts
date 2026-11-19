/**
 * What each agent that is not released yet will do, for its coming-soon page: a short pitch, a worked
 * example the page animates (something arrives, the agent works it, what comes out), the capabilities it
 * will have under the tabs already in the sidebar, and what is usable today. Plain words, no promised dates
 * and no numbers presented as results: every figure in a scene is an example and the page says so.
 */
import type { AgentId } from "./navigation";

export type MockKind = "photos" | "checklist" | "chat" | "calendar" | "bars" | "offer" | "list" | "week" | "progress";

export type SceneStep = { title: string; detail: string };

export type Capability = {
  /** The sidebar tab this lives under. */
  tab: string;
  title: string;
  detail: string;
  mock: MockKind;
};

export type ComingSoonAgent = {
  id: Extract<AgentId, "marketing" | "quality" | "customer-care" | "team-coordinator">;
  name: string;
  department: string;
  pitch: string;
  /** The worked example: what arrives, how the agent works it, and what it produces. */
  scene: { trigger: SceneStep; work: string[]; outcomes: SceneStep[] };
  capabilities: Capability[];
  /** Parts already usable today, with where to find them. */
  availableNow?: { label: string; detail: string; path: string }[];
  plan: string;
};

export const COMING_SOON: Record<ComingSoonAgent["id"], ComingSoonAgent> = {
  marketing: {
    id: "marketing",
    name: "Marketing",
    department: "Growth",
    pitch: "Fills the quiet days on your calendar: plans campaigns and promotions from your own customers and services, writes them, sends them only to people who agreed to hear from you, and shows what each one booked.",
    scene: {
      trigger: { title: "A slow week ahead", detail: "6 open slots Tuesday to Thursday" },
      work: ["Looks at past customers, service areas and what usually books mid-week", "Picks the customers who agreed to marketing", "Drafts an offer in your voice"],
      outcomes: [
        { title: "Mid-week deep clean offer drafted", detail: "Ready for your approval" },
        { title: "Sent to 140 past customers", detail: "Only those who opted in" },
        { title: "9 bookings traced to it", detail: "Measured from the Sales pipeline" },
      ],
    },
    capabilities: [
      { tab: "Campaigns", title: "Campaigns that fill gaps", detail: "Plans sends around your open capacity, seasons and service areas, and keeps them to people who agreed to marketing.", mock: "calendar" },
      { tab: "Promotions", title: "Offers you control", detail: "Drafts promotions with the limits you set: which services, how much, until when. Nothing goes out without your approval.", mock: "offer" },
      { tab: "Lead Sources", title: "Where customers come from", detail: "Brings Google, referrals, your booking pages and campaigns into one view, so you know what's worth paying for.", mock: "bars" },
      { tab: "Performance", title: "What each campaign booked", detail: "Ties sends to inquiries and bookings Sales handled, instead of opens and clicks.", mock: "progress" },
    ],
    availableNow: [{ label: "Content & Creative", detail: "Create images and short videos for your business with Creative Studio today.", path: "/app/agents/marketing/content-creative" }],
    plan: "Included in the Expand plan when it's released.",
  },
  quality: {
    id: "quality",
    name: "Quality",
    department: "Operations",
    pitch: "Checks every finished visit against what was promised: reads the photos and checklist, spots what was missed, asks the cleaner first, and lines up a re-clean before the customer has to complain.",
    scene: {
      trigger: { title: "Visit finished at 12 Elm St", detail: "18 photos · checklist 23 of 24" },
      work: ["Compares the photos with the home's scope and checklist", "Notices the oven interior was never shown", "Checks whether the customer asked for it"],
      outcomes: [
        { title: "One item flagged", detail: "Oven interior: no photo" },
        { title: "Cleaner asked for a photo", detail: "Before anything reaches the customer" },
        { title: "Re-clean ready if needed", detail: "Proposed for your approval" },
      ],
    },
    capabilities: [
      { tab: "Completion Review", title: "Every visit reviewed", detail: "Reads completion photos and notes against the property's scope, so gaps are found the same day.", mock: "photos" },
      { tab: "Checklists & Photos", title: "Checklists that match the home", detail: "Keeps each property's checklist and required photos current with its approved scope.", mock: "checklist" },
      { tab: "Service Issues", title: "Issues traced to the cause", detail: "Groups repeat problems by home, task and cleaner, so coaching is specific and fair.", mock: "list" },
      { tab: "Re-cleans", title: "Re-cleans arranged", detail: "Proposes the visit, the crew and what the crew is paid, and hands it to Dispatch once you approve.", mock: "calendar" },
    ],
    plan: "Included in the Expand plan when it's released.",
  },
  "customer-care": {
    id: "customer-care",
    name: "Customer Care",
    department: "Operations",
    pitch: "Answers customers the way your best office person would: reschedules, sets up new homes, takes service requests and keeps every promise visible to the team.",
    scene: {
      trigger: { title: "Text from Dana", detail: "“Can we move Friday to Monday?”" },
      work: ["Checks Dana's plan and your rescheduling rules", "Finds times her usual crew is free", "Writes back in your company's voice"],
      outcomes: [
        { title: "Two open times offered", detail: "Monday 10am or 1pm" },
        { title: "Dana picks Monday 10am", detail: "Confirmed by text" },
        { title: "Schedule and crew updated", detail: "Dispatch tells the crew" },
      ],
    },
    capabilities: [
      { tab: "Conversations", title: "Every customer message answered", detail: "Replies to texts and email within the rules you set, and hands anything sensitive to a person.", mock: "chat" },
      { tab: "Customer Setup", title: "New homes set up right", detail: "Collects access, pets, alarm codes, parking and priorities before the first visit.", mock: "checklist" },
      { tab: "Service Requests", title: "Requests tracked to done", detail: "Add-ons, special instructions and one-time asks, logged against the property so the crew sees them.", mock: "list" },
      { tab: "Rescheduling & Cancellations", title: "Changes handled by your rules", detail: "Moves and skips visits within your notice periods and fees, and tells Dispatch and the crew.", mock: "week" },
    ],
    plan: "Included in the Expand plan when it's released.",
  },
  "team-coordinator": {
    id: "team-coordinator",
    name: "Team Coordinator",
    department: "Team",
    pitch: "Gets new cleaners from “hired” to “ready for jobs” and keeps your team current: paperwork, training, availability and regular check-ins, without you chasing anyone.",
    scene: {
      trigger: { title: "Maria accepted your offer", detail: "Handed over from Recruiter" },
      work: ["Builds her onboarding from your requirements", "Sends each step to her phone", "Follows up on what's missing"],
      outcomes: [
        { title: "Agreement and W-9 signed", detail: "Filed on her record" },
        { title: "Training finished", detail: "3 of 3 modules" },
        { title: "Ready for jobs Monday", detail: "Dispatch can offer her work" },
      ],
    },
    capabilities: [
      { tab: "Onboarding", title: "Onboarding that finishes itself", detail: "Turns your requirements into steps each new cleaner completes from their phone.", mock: "progress" },
      { tab: "Documents & Training", title: "Documents that stay current", detail: "Tracks agreements, IDs, insurance and training, and asks for renewals before they lapse.", mock: "list" },
      { tab: "Readiness", title: "Who can work, at a glance", detail: "Shows who is cleared for which jobs, and what is blocking the rest.", mock: "checklist" },
      { tab: "Availability", title: "Availability kept up to date", detail: "Asks each cleaner for their week and keeps Dispatch working from real answers.", mock: "week" },
      { tab: "Team Check-ins", title: "Regular check-ins", detail: "Short check-ins with each cleaner, so you hear about problems before someone quits.", mock: "chat" },
    ],
    plan: "Included in the Expand plan when it's released.",
  },
};

export function comingSoonAgent(id: string): ComingSoonAgent | null {
  return id in COMING_SOON ? COMING_SOON[id as ComingSoonAgent["id"]] : null;
}
