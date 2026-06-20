"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  upsertPackage,
  upsertAddon,
  setPackageActive,
  setAddonActive,
} from "@/app/actions/packages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Textarea, Select } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { fromCents } from "@/lib/money";

type Pkg = {
  id: string;
  name: string;
  description: string | null;
  base_price_cents: number;
  default_cadence_key: string;
  recurring_discount_pct: number | null;
  active: boolean;
};
type Addon = { id: string; name: string; price_cents: number; active: boolean };
type Cadence = { key: string; label: string };

export function ServicesView({
  packages,
  addons,
  cadences,
}: {
  packages: Pkg[];
  addons: Addon[];
  cadences: Cadence[];
}) {
  const [editingPkg, setEditingPkg] = useState<Pkg | "new" | null>(null);
  const [editingAddon, setEditingAddon] = useState<Addon | "new" | null>(null);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Services
        </h1>
        <p className="text-sm text-muted-foreground">
          Your menu of packages and add-ons. Prices here apply to{" "}
          <span className="font-medium text-foreground">new enrollments</span>{" "}
          only — to change an existing customer&apos;s price, open their account.
        </p>
      </div>

      {/* Packages */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Packages</CardTitle>
          <Button size="sm" onClick={() => setEditingPkg("new")}>
            Add package
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {packages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No packages yet. Without any, the capture page uses the simple
              single-price flow.
            </p>
          )}
          {packages.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {p.name}
                  {!p.active && (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                      inactive
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  <Money value={fromCents(p.base_price_cents)} /> ·{" "}
                  {p.default_cadence_key}
                  {p.recurring_discount_pct != null &&
                    ` · ${p.recurring_discount_pct}% off`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditingPkg(p)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await setPackageActive(p.id, !p.active);
                    toast.success(p.active ? "Deactivated." : "Activated.");
                  }}
                >
                  {p.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Add-ons */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Add-ons</CardTitle>
          <Button size="sm" onClick={() => setEditingAddon("new")}>
            Add add-on
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {addons.length === 0 && (
            <p className="text-sm text-muted-foreground">No add-ons yet.</p>
          )}
          {addons.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-xl border p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {a.name}
                  {!a.active && (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                      inactive
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  +<Money value={fromCents(a.price_cents)} />
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingAddon(a)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await setAddonActive(a.id, !a.active);
                    toast.success(a.active ? "Deactivated." : "Activated.");
                  }}
                >
                  {a.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {editingPkg && (
        <PackageEditor
          pkg={editingPkg === "new" ? null : editingPkg}
          cadences={cadences}
          onClose={() => setEditingPkg(null)}
        />
      )}
      {editingAddon && (
        <AddonEditor
          addon={editingAddon === "new" ? null : editingAddon}
          onClose={() => setEditingAddon(null)}
        />
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-2xl bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PackageEditor({
  pkg,
  cadences,
  onClose,
}: {
  pkg: Pkg | null;
  cadences: Cadence[];
  onClose: () => void;
}) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [price, setPrice] = useState(
    pkg ? (pkg.base_price_cents / 100).toString() : ""
  );
  const [cadence, setCadence] = useState(
    pkg?.default_cadence_key ?? cadences[0]?.key ?? "biweekly"
  );
  const [discount, setDiscount] = useState(
    pkg?.recurring_discount_pct != null ? String(pkg.recurring_discount_pct) : ""
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await upsertPackage({
      id: pkg?.id,
      name,
      description,
      basePriceCents: Math.round(Number(price) * 100),
      defaultCadenceKey: cadence,
      recurringDiscountPct: discount.trim() === "" ? null : Number(discount),
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not save.");
      return;
    }
    toast.success("Package saved.");
    onClose();
  }

  return (
    <Modal title={pkg ? "Edit package" : "Add package"} onClose={onClose}>
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard Clean" />
      </Field>
      <Field label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's included…"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Base price ($)" required>
          <Input
            type="number"
            min={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Default cadence">
          <Select value={cadence} onChange={(e) => setCadence(e.target.value)}>
            {cadences.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Discount override (%)"
        hint="Optional — overrides the org default recurring discount for this package."
      >
        <Input
          type="number"
          min={0}
          max={90}
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="(use org default)"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save package"}
        </Button>
      </div>
    </Modal>
  );
}

function AddonEditor({
  addon,
  onClose,
}: {
  addon: Addon | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(addon?.name ?? "");
  const [price, setPrice] = useState(
    addon ? (addon.price_cents / 100).toString() : ""
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await upsertAddon({
      id: addon?.id,
      name,
      priceCents: Math.round(Number(price) * 100),
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not save.");
      return;
    }
    toast.success("Add-on saved.");
    onClose();
  }

  return (
    <Modal title={addon ? "Edit add-on" : "Add add-on"} onClose={onClose}>
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inside fridge" />
      </Field>
      <Field label="Price ($)" required>
        <Input
          type="number"
          min={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save add-on"}
        </Button>
      </div>
    </Modal>
  );
}
