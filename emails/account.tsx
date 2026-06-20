import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Button, Banner } from "./_components/ui";

export function DeletionScheduled({
  orgName,
  scheduledDate,
  cancelUrl,
}: {
  orgName: string;
  scheduledDate: string;
  cancelUrl: string;
}) {
  return (
    <EmailLayout
      brand={{ name: "Renuvo" }}
      preview="Your account is scheduled for deletion"
      footer={{ address: "Renuvo, Inc." }}
    >
      <Title>Account deletion scheduled</Title>
      <Banner tone="danger">
        {orgName} is scheduled for deletion on {scheduledDate}.
      </Banner>
      <Para>
        If this wasn&apos;t intentional, you can cancel the deletion any time before
        that date and nothing will be lost.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={cancelUrl}>Cancel deletion</Button>
      </div>
    </EmailLayout>
  );
}

export default function Preview() {
  return (
    <DeletionScheduled
      orgName="Novara Cleaning"
      scheduledDate="Jul 5, 2026"
      cancelUrl="https://app.renuvo.io/dashboard/settings/data"
    />
  );
}
