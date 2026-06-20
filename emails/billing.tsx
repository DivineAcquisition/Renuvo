import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Muted, Button, InfoRow, Banner } from "./_components/ui";

const RENUVO = { name: "Renuvo" };

export function SubscriptionReceipt({
  orgName,
  plan,
  amount,
  periodEnd,
  manageUrl,
}: {
  orgName: string;
  plan: string;
  amount: string;
  periodEnd: string;
  manageUrl: string;
}) {
  return (
    <EmailLayout
      brand={RENUVO}
      preview={`Your ${plan} receipt`}
      footer={{
        address: "Renuvo, Inc.",
        note: "This is a receipt for your Renuvo subscription.",
      }}
    >
      <Title>Payment received</Title>
      <Para>Thanks, {orgName}. Your {plan} plan is active.</Para>
      <InfoRow label="Plan" value={plan} />
      <InfoRow label="Amount" value={amount} mono strong />
      <InfoRow label="Next renewal" value={periodEnd} mono />
      <div style={{ marginTop: 18 }}>
        <Button href={manageUrl}>Manage billing</Button>
      </div>
    </EmailLayout>
  );
}

export function PaymentFailed({
  orgName,
  updateUrl,
  retryDate,
}: {
  orgName: string;
  updateUrl: string;
  retryDate?: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Your payment didn't go through" footer={{ address: "Renuvo, Inc." }}>
      <Title>Your payment failed</Title>
      <Banner tone="danger">We couldn&apos;t process your last Renuvo payment.</Banner>
      <Para>
        Hi {orgName}, update your card to keep your plan active
        {retryDate ? ` — we&apos;ll retry on ${retryDate}.` : "."}
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={updateUrl}>Update payment</Button>
      </div>
    </EmailLayout>
  );
}

export function TrialEnding({
  orgName,
  daysLeft,
  addCardUrl,
}: {
  orgName: string;
  daysLeft: number;
  addCardUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview={`${daysLeft} days left in your trial`} footer={{ address: "Renuvo, Inc." }}>
      <Title>Your trial ends in {daysLeft} days</Title>
      <Para>
        Hi {orgName}, add a card so your recurring revenue engine keeps running when
        the trial ends.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={addCardUrl}>Add a card</Button>
      </div>
      <Muted>No charge until your trial is over.</Muted>
    </EmailLayout>
  );
}

export default function Preview() {
  return (
    <SubscriptionReceipt
      orgName="Novara Cleaning"
      plan="Pro"
      amount="$197.00"
      periodEnd="Jul 20, 2026"
      manageUrl="https://app.renuvo.io/dashboard/settings/payments"
    />
  );
}
