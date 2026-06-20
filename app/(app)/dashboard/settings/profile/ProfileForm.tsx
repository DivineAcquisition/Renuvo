"use client";

import { useState } from "react";
import { updateBusinessProfile } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function ProfileForm({
  org,
  isOwner,
}: {
  org: {
    name: string;
    timezone: string;
    quiet_hours_start: number;
    quiet_hours_end: number;
  };
  isOwner: boolean;
}) {
  const [name, setName] = useState(org.name);
  const [tz, setTz] = useState(org.timezone);
  const [qs, setQs] = useState(org.quiet_hours_start);
  const [qe, setQe] = useState(org.quiet_hours_end);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await updateBusinessProfile({
      name,
      timezone: tz,
      quietStart: qs,
      quietEnd: qe,
    });
    setBusy(false);
    setNote("error" in res ? res.error ?? "Could not save." : "Saved.");
  }

  const hour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Business name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Timezone</Label>
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            disabled={!isOwner}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Texts allowed from</Label>
            <select
              value={qs}
              onChange={(e) => setQs(Number(e.target.value))}
              disabled={!isOwner}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 5).map((h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Until</Label>
            <select
              value={qe}
              onChange={(e) => setQe(Number(e.target.value))}
              disabled={!isOwner}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => (
                <option key={h} value={h}>
                  {hour(h % 24)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isOwner && (
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {note && (
              <span className="text-sm text-muted-foreground">{note}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
