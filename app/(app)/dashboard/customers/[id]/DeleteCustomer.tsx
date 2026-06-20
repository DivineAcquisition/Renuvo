"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteCustomerData } from "@/app/actions/customer-deletion";
import { Button } from "@/components/ui/button";

export function DeleteCustomer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (
      !confirm(
        "Delete this customer's data? This anonymizes their personal info and scrubs message contents (irreversible). Consent proof is retained as required by law."
      )
    )
      return;
    setBusy(true);
    const res = await deleteCustomerData(customerId);
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not delete.");
    else {
      toast.success("Customer data deleted.");
      router.push("/dashboard/inbox");
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      onClick={del}
      disabled={busy}
    >
      Delete customer data
    </Button>
  );
}
