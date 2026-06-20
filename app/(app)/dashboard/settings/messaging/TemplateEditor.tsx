"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveTemplate } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const VARS =
  "{{first_name}} · {{business_name}} · {{cadence_label}} · {{price}} · {{booking_link}}";

export function TemplateEditor({
  verticalId,
  rows,
  isOwner,
}: {
  verticalId: string;
  rows: {
    eventKey: string;
    label: string;
    body: string;
    isOverride: boolean;
  }[];
  isOwner: boolean;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">Merge variables: {VARS}</p>
      {rows.map((r) => (
        <TemplateRow
          key={r.eventKey}
          verticalId={verticalId}
          row={r}
          isOwner={isOwner}
        />
      ))}
    </div>
  );
}

function TemplateRow({
  verticalId,
  row,
  isOwner,
}: {
  verticalId: string;
  row: { eventKey: string; label: string; body: string; isOverride: boolean };
  isOwner: boolean;
}) {
  const [body, setBody] = useState(row.body);
  const [isOverride, setIsOverride] = useState(row.isOverride);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await saveTemplate(verticalId, row.eventKey, body);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not save.");
    } else {
      setIsOverride(true);
      toast.success("Template saved (override active).");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{row.label}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {isOverride ? "Custom" : "Default"}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          disabled={!isOwner}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {body.length} chars
          </span>
          {isOwner && (
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "…" : "Save"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
