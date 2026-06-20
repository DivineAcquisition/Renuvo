import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Button, InfoRow, Banner } from "./_components/ui";

const RENUVO = { name: "Renuvo" };

export function LowBalance({
  orgName,
  balance,
  addFundsUrl,
}: {
  orgName: string;
  balance: string;
  addFundsUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Your SMS balance is low" footer={{ address: "Renuvo, Inc." }}>
      <Title>Your SMS balance is running low</Title>
      <Banner tone="warn">Top up so your sequences keep sending.</Banner>
      <Para>Hi {orgName}, your current balance is below the reload threshold.</Para>
      <InfoRow label="Current balance" value={balance} mono strong />
      <div style={{ marginTop: 16 }}>
        <Button href={addFundsUrl}>Add funds</Button>
      </div>
    </EmailLayout>
  );
}

export function ReloadReceipt({
  orgName,
  amount,
  newBalance,
}: {
  orgName: string;
  amount: string;
  newBalance: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="SMS balance topped up" footer={{ address: "Renuvo, Inc.", note: "Auto-reload receipt." }}>
      <Title>Balance topped up</Title>
      <Para>Hi {orgName}, your SMS balance was automatically reloaded.</Para>
      <InfoRow label="Reloaded" value={amount} mono />
      <InfoRow label="New balance" value={newBalance} mono strong />
    </EmailLayout>
  );
}

export default function Preview() {
  return (
    <LowBalance
      orgName="Novara Cleaning"
      balance="$3.40"
      addFundsUrl="https://app.renuvo.io/dashboard/settings/payments"
    />
  );
}
