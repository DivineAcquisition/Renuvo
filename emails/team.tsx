import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Muted, Button } from "./_components/ui";

export function Invitation({
  inviter,
  orgName,
  acceptUrl,
}: {
  inviter: string;
  orgName: string;
  acceptUrl: string;
}) {
  return (
    <EmailLayout
      brand={{ name: "Renuvo" }}
      preview={`${inviter} invited you to ${orgName}`}
      footer={{ address: "Renuvo, Inc." }}
    >
      <Title>You&apos;re invited to {orgName}</Title>
      <Para>
        {inviter} invited you to join {orgName} on Renuvo. Accept to get access.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={acceptUrl}>Join {orgName}</Button>
      </div>
      <Muted>This invitation expires in 14 days.</Muted>
    </EmailLayout>
  );
}

export default function Preview() {
  return (
    <Invitation
      inviter="Sam"
      orgName="Novara Cleaning"
      acceptUrl="https://app.renuvo.io/accept/abc"
    />
  );
}
