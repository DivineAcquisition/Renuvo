/**
 * Selestial's catalog in Autumn, for the `atmn` CLI (https://docs.useautumn.com/cli/config):
 *
 *   cd billing && npx atmn push          preview
 *   cd billing && npx atmn push --yes    apply
 *
 * Built from the same plan-to-agent mapping the app checks (convex/lib/billing/catalog.ts), so the two
 * cannot disagree. Prices are the approved $299 and $499. Credit allowances and top-up prices are NOT
 * approved yet, so they are read from the environment and this file refuses to build without them;
 * nothing here invents a commercial value. For Autumn's sandbox, load billing/sandbox.env.example (test
 * values only). For production, Selestial supplies the approved values.
 *
 * Careful: each list below is the complete list. `atmn push` deletes from Autumn any feature or plan that
 * is not in it.
 */
import { atmn, feature, plan } from "atmn";

import { AGENT_CATALOG, AGENT_IDS, AUTUMN, PLAN_FEATURES, PLANS, type PlanId } from "../convex/lib/billing/catalog";

function required(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} is not set. Credit values are not approved; set it from the approved commercial values (or the sandbox test file).`);
  return value;
}

const operateCredits = required("SELESTIAL_OPERATE_CREDITS");
// The starting design: Expand gets twice Operate's allowance, unless a different value is approved.
const expandCredits = process.env.SELESTIAL_EXPAND_CREDITS ? required("SELESTIAL_EXPAND_CREDITS") : operateCredits * 2;
const topUpPrice = process.env.SELESTIAL_TOP_UP_PRICE ? Number(process.env.SELESTIAL_TOP_UP_PRICE) : null;
const topUpUnits = process.env.SELESTIAL_TOP_UP_UNITS ? required("SELESTIAL_TOP_UP_UNITS") : null;

export const credits = feature({ featureId: AUTUMN.credits, name: "Selestial Credits", type: "metered", consumable: true });

const agentFeatures = AGENT_IDS.map((agent) => feature({ featureId: `agent_${agent.replace(/-/g, "_")}`, name: `${AGENT_CATALOG[agent].name} agent`, type: "boolean" }));
const platformFeatures = (Object.keys(PLAN_FEATURES) as (keyof typeof PLAN_FEATURES)[]).map((id) => feature({ featureId: `feature_${id}`, name: PLAN_FEATURES[id].name, type: "boolean" }));

function subscription(id: PlanId, included: number) {
  return plan({
    planId: AUTUMN.plans[id],
    versionSlug: "v1",
    active: true,
    name: PLANS[id].name,
    group: "selestial",
    price: { amount: PLANS[id].monthlyCents / 100, interval: "month" },
    items: [
      // Included monthly credits, reset each billing period, no rollover.
      { featureId: credits.featureId, included, reset: { interval: "month" } },
      ...AGENT_IDS.filter((agent) => AGENT_CATALOG[agent].plans.includes(id)).map((agent) => ({ featureId: `agent_${agent.replace(/-/g, "_")}` })),
      ...(Object.keys(PLAN_FEATURES) as (keyof typeof PLAN_FEATURES)[]).filter((key) => (PLAN_FEATURES[key].plans as readonly PlanId[]).includes(id)).map((key) => ({ featureId: `feature_${key}` })),
    ],
  });
}

const plans = [subscription("operate", operateCredits), subscription("expand", expandCredits)];
if (topUpPrice !== null && topUpUnits !== null) {
  // A prepaid, one-off add-on: it adds credits and nothing else.
  plans.push(plan({ planId: AUTUMN.topUpPlan, versionSlug: "v1", active: true, name: "Credit top-up", addOn: true, items: [{ featureId: credits.featureId, price: { amount: topUpPrice, billingUnits: topUpUnits, interval: "one_off", billingMethod: "prepaid" } }] }));
}

export default atmn({ features: [credits, ...agentFeatures, ...platformFeatures], plans });
