"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createCaptureLink, sendCaptureLinkSms } from "@/app/actions/capture-links";
import { Button } from "@/components/ui/button";

export function EnrollButton({
  customerId,
  sendable,
}: {
  customerId: string;
  sendable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  async function enroll() {
    setBusy(true);
    const res = await createCaptureLink({ linkType: "customer", customerId });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error ?? "Could not create link.");
      return;
    }
    const url = res.url ?? "";
    await navigator.clipboard.writeText(url).catch(() => {});
    setLink({ id: "", url });
    toast.success("Enrollment link created & copied.");
  }

  async function send() {
    if (!sendable) {
      toast.error("Customer hasn't consented to texts.");
      return;
    }
    setBusy(true);
    const res = await createCaptureLink({ linkType: "customer", customerId });
    if ("error" in res || !res.id) {
      setBusy(false);
      toast.error("Could not create link.");
      return;
    }
    const sent = await sendCaptureLinkSms(res.id, customerId);
    setBusy(false);
    if ("error" in sent) toast.error(sent.error ?? "Could not send.");
    else toast.success("Enrollment link texted.");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={enroll} disabled={busy}>
        Enroll
      </Button>
      {link && (
        <span className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
          {link.url}
        </span>
      )}
      {sendable && (
        <Button variant="ghost" size="sm" onClick={send} disabled={busy}>
          Create &amp; text
        </Button>
      )}
    </div>
  );
}
