"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startGenericEnrollment } from "@/app/actions/capture-links";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GenericLeadForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    if (!name.trim() || !phone.trim()) {
      setErr("Enter your name and phone.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await startGenericEnrollment(token, {
      name: name.trim(),
      phone: phone.trim(),
    });
    setBusy(false);
    if ("error" in res) {
      setErr(res.error ?? "Could not continue.");
      return;
    }
    router.push(`/${res.token}`);
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <Label>Your name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Mobile number</Label>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 123 4567"
        />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <button
        onClick={start}
        disabled={busy}
        className="hover-lift w-full rounded-xl bg-gradient-to-r from-[#6A57FF] to-[#4F38FF] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-60"
      >
        {busy ? "Starting…" : "Continue"}
      </button>
    </div>
  );
}
