"use client";

import { useState } from "react";
import { inviteTeamMember, removeTeamMember } from "@/app/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Member = {
  profileId: string;
  role: "owner" | "staff";
  email: string;
  fullName: string | null;
};

export function TeamManager({
  members,
  isOwner,
}: {
  members: Member[];
  isOwner: boolean;
}) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setNote(null);
    const res = await inviteTeamMember(email.trim());
    setBusy(false);
    if ("error" in res) setNote(res.error ?? "Could not invite.");
    else {
      setEmail("");
      setNote("Invite sent.");
    }
  }

  async function remove(profileId: string) {
    setNote(null);
    const res = await removeTeamMember(profileId);
    if ("error" in res) setNote(res.error ?? "Could not remove.");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => (
            <div
              key={m.profileId}
              className="flex items-center justify-between border-b py-2 text-sm"
            >
              <div>
                <p className="font-medium">{m.fullName ?? m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold capitalize text-muted-foreground">
                  {m.role}
                </span>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(m.profileId)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          )}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="name@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button onClick={invite} disabled={busy}>
                {busy ? "Inviting…" : "Invite"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              They&apos;ll get an email to set a password and join as staff.
            </p>
          </CardContent>
        </Card>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
