"use client";

import { useState } from "react";
import { toast } from "sonner";
import { submitBrand, submitCampaign, syncA2pStatus } from "@/app/actions/a2p";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type A2pReg = {
  entity_type: string | null;
  step: string | null;
  legal_name: string | null;
  display_name: string | null;
  ein: string | null;
  business_phone: string | null;
  business_email: string | null;
  website: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  vertical: string | null;
  brand_status: string | null;
  campaign_status: string | null;
};

function StatusPill({ value }: { value: string | null | undefined }) {
  const v = value ?? "—";
  const tone =
    v === "VERIFIED" || v === "APPROVED"
      ? "bg-emerald-100 text-emerald-700"
      : v === "FAILED"
        ? "bg-destructive/10 text-destructive"
        : "bg-amber-100 text-amber-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {v}
    </span>
  );
}

export function A2pWizard({
  reg,
  isOwner,
  businessName,
  a2pStatus,
  hasNumber,
}: {
  reg: A2pReg | null;
  isOwner: boolean;
  businessName: string;
  a2pStatus: string;
  hasNumber: boolean;
}) {
  const brandVerified = reg?.brand_status === "VERIFIED";
  const campaignApproved =
    reg?.campaign_status === "APPROVED" || a2pStatus === "approved";
  const live = a2pStatus === "approved";

  const [busy, setBusy] = useState(false);
  const [entityType, setEntityType] = useState(
    reg?.entity_type ?? "SOLE_PROPRIETOR"
  );
  const [form, setForm] = useState({
    legalName: reg?.legal_name ?? "",
    displayName: reg?.display_name ?? businessName,
    ein: reg?.ein ?? "",
    phone: reg?.business_phone ?? "",
    email: reg?.business_email ?? "",
    website: reg?.website ?? "",
    street: reg?.street ?? "",
    city: reg?.city ?? "",
    state: reg?.state ?? "",
    postalCode: reg?.postal_code ?? "",
    vertical: reg?.vertical ?? "PROFESSIONAL",
  });
  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmitBrand() {
    if (entityType === "PRIVATE_PROFIT" && !form.ein.trim()) {
      toast.error("EIN is required for an LLC / registered business.");
      return;
    }
    setBusy(true);
    const res = await submitBrand({
      entityType,
      legalName: form.legalName.trim(),
      displayName: form.displayName.trim(),
      ein: entityType === "PRIVATE_PROFIT" ? form.ein.trim() : undefined,
      phone: form.phone.trim(),
      email: form.email.trim(),
      website: form.website.trim() || undefined,
      street: form.street.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      postalCode: form.postalCode.trim(),
      vertical: form.vertical,
    });
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Submission failed.");
    else toast.success("Brand submitted — verifying.");
  }

  async function onSubmitCampaign() {
    setBusy(true);
    const res = await submitCampaign();
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Submission failed.");
    else toast.success("Campaign submitted for review.");
  }

  async function onCheck() {
    setBusy(true);
    const res = await syncA2pStatus();
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not check status.");
    else toast.success("Status updated.");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          SMS delivery (A2P 10DLC)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          US carriers require every business to register before texts deliver
          reliably. Renuvo handles the carrier registration on your behalf and
          fills in the messaging campaign — you only provide your business
          identity. Registration fees are covered by your Renuvo plan. Timing:
          brand minutes–hours (sole proprietors up to ~24h), brand vetting 1–7
          business days, campaign review 5–10 business days. Start now — the
          campaign review is the slow step.
        </p>
      </div>

      {/* status banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <span className="text-muted-foreground">Brand</span>
        <StatusPill value={reg?.brand_status} />
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Campaign</span>
        <StatusPill value={reg?.campaign_status} />
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Sending</span>
        <StatusPill value={live ? "APPROVED" : "PENDING"} />
        {reg && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCheck}
            disabled={busy}
            className="ml-auto"
          >
            {busy ? "Checking…" : "Check status"}
          </Button>
        )}
      </div>

      {!isOwner && (
        <p className="text-sm text-muted-foreground">
          Only an owner can submit A2P registration. You can view status above.
        </p>
      )}

      {/* STEP 3 — live */}
      {live && (
        <Card>
          <CardContent className="pt-6">
            <p className="font-display text-lg font-bold text-primary">
              ✅ You&apos;re approved
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Renuvo can now text your customers from your registered number.
            </p>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — campaign (after brand verified, before approval) */}
      {isOwner && brandVerified && !campaignApproved && (
        <Card>
          <CardHeader>
            <CardTitle>Messaging campaign</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Renuvo prepared this campaign from your own message templates and
              consent flow. Review and submit — no 10DLC expertise needed.
            </p>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Use case:</span>{" "}
                Mixed (reminders + recurring offers)
              </li>
              <li>
                <span className="font-medium text-foreground">Opt-in:</span> SMS
                consent box on the signup page / written consent at booking
              </li>
              <li>
                <span className="font-medium text-foreground">Opt-out:</span>{" "}
                STOP, UNSUBSCRIBE, CANCEL, END, QUIT
              </li>
              <li>
                <span className="font-medium text-foreground">Help:</span> HELP
              </li>
              <li>
                <span className="font-medium text-foreground">Samples:</span>{" "}
                your activation &amp; recurring-offer templates
              </li>
            </ul>
            {reg?.campaign_status ? (
              <p className="text-sm">
                Submitted — status <StatusPill value={reg.campaign_status} />
              </p>
            ) : (
              <Button onClick={onSubmitCampaign} disabled={busy}>
                {busy ? "Submitting…" : "Submit campaign"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 1 — brand identity (until verified) */}
      {isOwner && !brandVerified && (
        <Card>
          <CardHeader>
            <CardTitle>Business identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Business type</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="entity"
                    checked={entityType === "SOLE_PROPRIETOR"}
                    onChange={() => setEntityType("SOLE_PROPRIETOR")}
                  />
                  I&apos;m a sole proprietor (no EIN)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="entity"
                    checked={entityType === "PRIVATE_PROFIT"}
                    onChange={() => setEntityType("PRIVATE_PROFIT")}
                  />
                  I have an LLC / EIN
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Legal name</Label>
                <Input
                  value={form.legalName}
                  onChange={(e) => set("legalName", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                />
              </div>
            </div>

            {entityType === "PRIVATE_PROFIT" && (
              <div className="space-y-1.5">
                <Label>EIN</Label>
                <Input
                  value={form.ein}
                  onChange={(e) => set("ein", e.target.value)}
                  placeholder="12-3456789"
                />
                <p className="text-xs text-muted-foreground">
                  Must match your IRS record exactly — a mismatch leaves the
                  brand permanently unverified.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Business phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+15551234567"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Business email</Label>
                <Input
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              A verification email may be sent here. Sole proprietors complete an
              identity check within ~24h.
            </p>

            <div className="space-y-1.5">
              <Label>Website (optional)</Label>
              <Input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Street</Label>
                <Input
                  value={form.street}
                  onChange={(e) => set("street", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input
                  value={form.state}
                  onChange={(e) => set("state", e.target.value)}
                  placeholder="TX"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Postal code</Label>
                <Input
                  value={form.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                />
              </div>
            </div>

            <Button onClick={onSubmitBrand} disabled={busy}>
              {busy ? "Submitting…" : "Submit for verification"}
            </Button>
          </CardContent>
        </Card>
      )}

      {!hasNumber && (
        <p className="text-xs text-muted-foreground">
          Tip: provision your texting number first (Onboarding → Get a number).
          A2P approval and a number are both required before sends go out.
        </p>
      )}
    </div>
  );
}
