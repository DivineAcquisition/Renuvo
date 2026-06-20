import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Muted, Button, InfoRow } from "./_components/ui";

const RENUVO = { name: "Renuvo" };

/** Generic owner notification — used for new_conversion, at_risk, failed_payment,
 *  reply_needs_human, approval_pending, wallet_low. */
export function EventAlert({
  title,
  body,
  ctaUrl,
  ctaLabel = "View in Renuvo",
  prefsUrl,
}: {
  title: string;
  body?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  prefsUrl?: string;
}) {
  return (
    <EmailLayout
      brand={RENUVO}
      preview={title}
      footer={{
        address: "Renuvo, Inc.",
        note: prefsUrl ? undefined : "You're receiving Renuvo notifications.",
        unsubscribeUrl: undefined,
      }}
    >
      <Title>{title}</Title>
      {body && <Para>{body}</Para>}
      {ctaUrl && (
        <div style={{ marginTop: 16 }}>
          <Button href={ctaUrl}>{ctaLabel}</Button>
        </div>
      )}
      {prefsUrl && (
        <Muted>
          Manage which emails you get in your{" "}
          <a href={prefsUrl} style={{ color: "#6b6880" }}>
            notification preferences
          </a>
          .
        </Muted>
      )}
    </EmailLayout>
  );
}

export function WeeklyDigest({
  orgName,
  mrr,
  conversions,
  atRisk,
  dashboardUrl,
}: {
  orgName: string;
  mrr: string;
  conversions: number;
  atRisk: number;
  dashboardUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Your week on Renuvo" footer={{ address: "Renuvo, Inc." }}>
      <Title>Your week, {orgName}</Title>
      <Para>Here&apos;s how your recurring revenue moved this week.</Para>
      <InfoRow label="Monthly recurring revenue" value={mrr} mono strong />
      <InfoRow label="New conversions" value={String(conversions)} mono />
      <InfoRow label="At-risk accounts" value={String(atRisk)} mono />
      <div style={{ marginTop: 18 }}>
        <Button href={dashboardUrl}>Open dashboard</Button>
      </div>
    </EmailLayout>
  );
}

export default function Preview() {
  return (
    <EventAlert
      title="New recurring conversion 🎉"
      body="A customer just started recurring service."
      ctaUrl="https://app.renuvo.io/dashboard"
      prefsUrl="https://app.renuvo.io/dashboard/settings/controls"
    />
  );
}
