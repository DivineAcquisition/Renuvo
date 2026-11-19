/**
 * What each agent can text, activity by activity, read from the company's registration as it is now.
 * Not one "texting on" switch: Dispatch can be ready for cleaners while Retention's promotions still need
 * setup. The sending policy enforces the same coverage before every text (convex/lib/messaging/policy.ts).
 */
import type { Doc } from "../../_generated/dataModel";
import type { MessagingSetup } from "../compliance/schema";
import { ACTIVITIES, type ActivityGroup } from "./activities";
import { covers } from "./plan";

export type ActivityReadiness = { key: string; label: string; ready: boolean };
export type AgentTexting = {
  agent: ActivityGroup;
  state: "ready" | "partly" | "setup_needed" | "in_progress" | "paused";
  label: string;
  words: string;
  activities: ActivityReadiness[];
};

const AUDIENCE: Record<ActivityGroup, string> = { sales: "people asking about a cleaning", recruiter: "applicants", dispatch: "cleaners", retention: "customers" };
const NAMES: Record<ActivityGroup, string> = { sales: "Sales", recruiter: "Recruiter", dispatch: "Dispatch", retention: "Retention" };
const STATE_LABEL: Record<AgentTexting["state"], string> = { ready: "Ready", partly: "Partly ready", setup_needed: "Setup needed", in_progress: "Getting ready", paused: "Paused" };

const list = (words: string[]) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

export function textingByAgent(messaging: MessagingSetup, request: Pick<Doc<"textingRequests">, "status"> | null): AgentTexting[] {
  const registration = messaging.registration;
  const live = registration.status === "approved" && !!messaging.smsNumber;
  return (["sales", "dispatch", "recruiter", "retention"] as const).map((agent) => {
    const rows = ACTIVITIES.filter((row) => row.group === agent);
    const name = NAMES[agent];
    if (!live) {
      const activities = rows.map((row) => ({ key: row.key, label: row.label, ready: false }));
      if (registration.status === "suspended" || request?.status === "interrupted") return { agent, state: "paused", label: STATE_LABEL.paused, words: `The carriers paused your texting, so ${name} can't text anyone until it's restored.`, activities };
      const working = request && ["requested", "approved", "provisioning", "waiting_on_carriers", "needs_you"].includes(request.status);
      return working
        ? { agent, state: "in_progress", label: STATE_LABEL.in_progress, words: `Your texting registration is under way. ${name} starts texting once it's ready.`, activities }
        : { agent, state: "setup_needed", label: STATE_LABEL.setup_needed, words: `Set up business texting so ${name} can text ${AUDIENCE[agent]}.`, activities };
    }
    const activities = rows.map((row) => ({ key: row.key, label: row.label, ready: covers(registration.coverage, row.audience, row.category) }));
    const ready = activities.filter((row) => row.ready);
    const missing = activities.filter((row) => !row.ready);
    const missingWords =
      missing.length === 1 && missing[0].key === "promotions"
        ? "Promotional texting is not included in your current registration."
        : `${list(missing.map((row) => row.label.toLowerCase())).replace(/^./, (c) => c.toUpperCase())} ${missing.length === 1 ? "isn't" : "aren't"} included in your current registration.`;
    if (missing.length === 0) return { agent, state: "ready", label: STATE_LABEL.ready, words: `Can send ${list(ready.map((row) => row.label.toLowerCase()))} to ${AUDIENCE[agent]} who agreed to texts.`, activities };
    if (ready.length === 0) return { agent, state: "setup_needed", label: STATE_LABEL.setup_needed, words: `${name}'s texts aren't included in your current registration. Add them in Set up business texting.`, activities };
    return {
      agent,
      state: "partly",
      label: STATE_LABEL.partly,
      words: `Can send ${list(ready.map((row) => row.label.toLowerCase()))} to ${AUDIENCE[agent]} who agreed to texts. ${missingWords}`,
      activities,
    };
  });
}
