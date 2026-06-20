"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markPaidManually } from "@/app/actions/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

/**
 * Manually record a paid job for a customer (e.g. a payment taken outside Stripe).
 * Runs the same conversion engine a Stripe charge would — so the recurring offer
 * sequence kicks off.
 */
export function RecordPayment({
  phone,
  fullName,
  smsSendable,
}: {
  phone: string;
  fullName: string | null;
  smsSendable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const cents = Math.round(Number(amount) * 100);
    if (!(cents > 0)) {
      toast.error("Enter a valid amount.");
      return;
    }
    setBusy(true);
    const res = await markPaidManually({
      phone,
      fullName: fullName ?? undefined,
      amountCents: cents,
      smsConsent: smsSendable,
    });
    setBusy(false);
    if (res && "error" in res) {
      toast.error(res.error ?? "Could not record payment.");
      return;
    }
    toast.success("Payment recorded.");
    setOpen(false);
    setAmount("");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="font-display text-lg font-bold">Record a payment</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Logs a paid job for {fullName ?? "this customer"} and starts the
                recurring-offer sequence{" "}
                {smsSendable ? "(they're SMS-consented)" : "(no SMS consent yet)"}.
              </p>
            </div>
            <Field label="Amount ($)" required>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="120"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={busy}>
                {busy ? "Recording…" : "Record payment"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
