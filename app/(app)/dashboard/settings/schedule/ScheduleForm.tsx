"use client";

import { useState } from "react";
import { updatePreferredCadence } from "@/app/actions/settings";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ScheduleForm({
  cadences,
  current,
  isOwner,
}: {
  cadences: { id: string; label: string; interval_days: number }[];
  current: string | null;
  isOwner: boolean;
}) {
  const [value, setValue] = useState(current ?? cadences[0]?.id ?? "");
  const [note, setNote] = useState<string | null>(null);

  async function onChange(next: string) {
    setValue(next);
    setNote(null);
    const res = await updatePreferredCadence(next);
    setNote("error" in res ? res.error ?? "Could not save." : "Saved.");
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Preferred cadence</Label>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={!isOwner}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {cadences.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} (every {c.interval_days} days)
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Default cadence offered when converting a one-time client.
          </p>
          {note && (
            <span className="text-sm text-muted-foreground">{note}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
