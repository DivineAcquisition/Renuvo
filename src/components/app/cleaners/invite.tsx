"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { Avatar, StatusBadge, type Row } from "@/components/app/cleaners/shared";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { CheckCircle2, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const RESULT_WORDS: Record<string, string> = { queued: "Being prepared", held: "Held until quiet hours end", sending: "Sending", sent: "Sent", delivered: "Delivered", not_sent: "Not sent", failed: "Not delivered", unconfirmed: "Sent, not confirmed" };

/**
 * Invites the chosen people to their portal, one text each through the send gate. What happened to each
 * text is shown as it is: prepared, held, sent or not sent with the reason. Nobody is invited twice by
 * this screen; a person who already has a working link is not offered.
 */
export function InvitePortalDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: Row[] }) {
  const company = useCompany();
  const invite = useMutation(api.workforce.invitePortal);
  const candidates = rows.filter((row) => (row.status === "onboarding" || row.status === "ready") && (row.portal === "none" || row.portal === "closed"));
  const [chosen, setChosen] = useState<Id<"cleaners">[]>([]);
  const [results, setResults] = useState<Record<string, { ok: boolean; words: string }>>({});
  const [busy, setBusy] = useState(false);
  const pending = chosen.filter((id) => !results[id]);
  return (
    <Modal open={open} onClose={onClose} title="Invite to the cleaner portal" description="Each person gets a text with their own link. They confirm it is them with a code sent to the same phone." wide>
      <div className="grid gap-3">
        {candidates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Everyone onboarding or active already has a working portal link.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-auto rounded-xl border border-border">
            {candidates.map((row) => {
              const on = chosen.includes(row.cleanerId);
              const result = results[row.cleanerId];
              return (
                <li key={row.cleanerId} className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" aria-label={`Invite ${row.name}`} checked={on} disabled={Boolean(result)} onChange={() => setChosen((current) => (on ? current.filter((id) => id !== row.cleanerId) : [...current, row.cleanerId]))} className="size-4 accent-[var(--color-brand-500)]" />
                  <Avatar initials={row.initials} seed={row.cleanerId} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-strong">
                      {row.name} <StatusBadge status={row.status} />
                    </span>
                    <span className="block text-xs text-muted-foreground">{row.phone ?? "No mobile number: the invitation cannot be texted"}</span>
                  </span>
                  {result ? (
                    <span className={`flex items-center gap-1 text-xs font-medium ${result.ok ? "text-success-foreground" : "text-destructive-foreground"}`}>
                      {result.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
                      {result.words}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">A text that cannot go (no permission for work texts, no number, texting not set up) is shown with the reason. You can then copy the person&apos;s link from their profile and give it to them yourself.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={busy}
            disabled={pending.length === 0}
            onClick={async () => {
              setBusy(true);
              for (const cleanerId of pending) {
                try {
                  const result = await invite({ companyId: company.companyId, cleanerId });
                  const ok = !["not_sent", "failed"].includes(result.status);
                  setResults((current) => ({ ...current, [cleanerId]: { ok, words: ok ? RESULT_WORDS[result.status] : `${RESULT_WORDS[result.status]}: ${result.problem ?? ""}` } }));
                } catch (error) {
                  setResults((current) => ({ ...current, [cleanerId]: { ok: false, words: messageOf(error) } }));
                }
              }
              setBusy(false);
            }}
          >
            Invite {pending.length > 0 ? pending.length : ""} {pending.length === 1 ? "person" : "people"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
