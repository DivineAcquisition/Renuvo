"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { formatUnits } from "../../../../convex/lib/messagingBilling/money";
import { rateCardAt } from "../../../../convex/lib/messagingBilling/rates";
import { countSegments, MAX_SEGMENTS, plainPunctuation } from "../../../../convex/lib/messagingBilling/segments";

/** The words shown under a text before it is sent. Pure, so the composer and tests agree with the server's count. */
export function segmentEstimate(body: string, options: { agent?: boolean; now?: number } = {}) {
  // Agent-written texts are sent with plain punctuation, as the server does; a person's words are sent as written.
  const text = options.agent ? plainPunctuation(body) : body;
  const count = countSegments(text);
  const card = rateCardAt(options.now ?? Date.now());
  const cost = count.segments * card.rates.sms_out;
  const words = `This message uses ${count.segments} SMS segment${count.segments === 1 ? "" : "s"}. Estimated cost: ${formatUnits(cost)}.`;
  // Characters that force the shorter Unicode segments, and the punctuation that could be swapped to avoid it.
  const fixable = !options.agent && count.encoding === "ucs2" && countSegments(plainPunctuation(text)).encoding === "gsm7";
  return { ...count, cost, words, fixable, characters: [...text].length };
}

/** A line under a text composer: segments, cost, and why a message costs more than expected. */
export function SegmentEstimate({ body, agent, className }: { body: string; agent?: boolean; className?: string }) {
  const estimate = useMemo(() => segmentEstimate(body, { agent }), [body, agent]);
  if (!body.trim()) return null;
  return (
    <p aria-live="polite" className={cn("text-xs", estimate.tooLong ? "text-destructive-foreground" : "text-muted-foreground", className)}>
      {estimate.tooLong ? `Too long to send as a text: it would use ${estimate.segments} segments, and the most is ${MAX_SEGMENTS}. Shorten it or send it by email.` : estimate.words}
      {!estimate.tooLong && estimate.encoding === "ucs2" ? (estimate.fixable ? " Curly quotes or long dashes make every segment shorter; plain ones would cost less." : " Emoji or special characters make every segment shorter.") : ""}
    </p>
  );
}
