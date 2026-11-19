"use client";

/**
 * Step 2: what the company will text, by content and audience. Each activity shows a sample written the
 * way Selestial sends it, and promotions are kept apart because they need separate permission. Below,
 * the registration Selestial recommends for what was chosen, and why.
 */
import { Megaphone } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

import { ACTIVITY_GROUPS } from "../../../../convex/lib/texting/activities";
import { AUDIENCE_LABEL, CATEGORY_LABEL } from "./catalog";
import { useSetup } from "./context";
import { Bubble, ChoiceCard, Note, Section, StepHeading } from "./parts";

export function ActivitiesStep() {
  const { view, commit, locked } = useSetup();
  const chosen = view.setup.activities;
  const toggle = (key: string) => void commit({ activities: chosen.includes(key) ? chosen.filter((row) => row !== key) : [...chosen, key] });
  const sole = view.setup.business.entityType === "SOLE_PROPRIETOR";

  return (
    <>
      <StepHeading eyebrow="Step 2 of 6" title="What you'll send" lead="Choose the texts your business will send. Carriers approve what you register, and Selestial only lets your agents send what's covered." />

      {ACTIVITY_GROUPS.map((group) => {
        const rows = view.catalog.activities.filter((row) => row.group === group && row.category !== "marketing");
        if (!rows.length) return null;
        const words = view.catalog.groups[group];
        return (
          <Section key={group} title={words.title} lead={words.who}>
            <div className="grid gap-2" role="group" aria-label={words.title}>
              {rows.map((row) => (
                <ChoiceCard key={row.key} multi selected={chosen.includes(row.key)} onPress={() => toggle(row.key)} title={row.label} hint={row.detail} disabled={locked}>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">{AUDIENCE_LABEL[row.audience]}</Badge>
                      <Badge variant="outline">{CATEGORY_LABEL[row.category]}</Badge>
                    </div>
                    {chosen.includes(row.key) ? <Bubble from="Sample">{row.sample}</Bubble> : null}
                  </div>
                </ChoiceCard>
              ))}
            </div>
          </Section>
        );
      })}

      <Section title="Promotions" lead="Offers and deals are marketing. They're kept separate from everything above.">
        {view.catalog.activities
          .filter((row) => row.category === "marketing")
          .map((row) => (
            <ChoiceCard key={row.key} multi selected={chosen.includes(row.key)} onPress={() => toggle(row.key)} title={row.label} hint={row.detail} disabled={locked || (sole && !chosen.includes(row.key))}>
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="warning">
                    <Megaphone aria-hidden />
                    Marketing
                  </Badge>
                </div>
                {chosen.includes(row.key) ? <Bubble from="Sample">{row.sample}</Bubble> : null}
              </div>
            </ChoiceCard>
          ))}
        <Note>
          Promotions go only to people who check a separate box agreeing to marketing texts. Agreeing to texts about their bookings never counts as agreeing to promotions.
          {sole ? " A sole proprietor registration can't include promotions." : ""}
        </Note>
      </Section>

      {view.plan ? (
        <Section title="What Selestial will register" lead="Based on what you chose. You don't need to pick carrier categories yourself.">
          <div className="grid gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 text-sm">
            <p className="font-semibold text-strong">{view.plan.title}</p>
            <p className="text-muted-foreground">{view.plan.why}</p>
            <p className="text-muted-foreground">{view.plan.limits}</p>
            <p className="text-xs text-muted-foreground">The registration costs the same whatever you choose here. You can add more later; a change after approval is filed as a corrected registration.</p>
          </div>
        </Section>
      ) : null}
    </>
  );
}
