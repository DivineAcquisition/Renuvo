import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Button, Banner } from "./_components/ui";

const RENUVO = { name: "Renuvo" };
const FOOTER = { address: "Renuvo, Inc." };

export function BrandVerified({ orgName, nextUrl }: { orgName: string; nextUrl: string }) {
  return (
    <EmailLayout brand={RENUVO} preview="Your business is verified" footer={FOOTER}>
      <Title>Your business is verified</Title>
      <Banner tone="success">Brand verification complete.</Banner>
      <Para>
        Hi {orgName}, your business passed carrier verification. Next, your messaging
        campaign goes to review.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={nextUrl}>View status</Button>
      </div>
    </EmailLayout>
  );
}

export function CampaignApproved({ orgName, dashboardUrl }: { orgName: string; dashboardUrl: string }) {
  return (
    <EmailLayout brand={RENUVO} preview="You can now text customers" footer={FOOTER}>
      <Title>You&apos;re cleared to text customers</Title>
      <Banner tone="success">A2P campaign approved.</Banner>
      <Para>
        Hi {orgName}, your messaging campaign is approved — Renuvo can now text your
        customers from your registered number.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={dashboardUrl}>Open dashboard</Button>
      </div>
    </EmailLayout>
  );
}

export function RegistrationActionNeeded({
  orgName,
  reason,
  fixUrl,
}: {
  orgName: string;
  reason: string;
  fixUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Action needed on your registration" footer={FOOTER}>
      <Title>Action needed to start texting</Title>
      <Banner tone="warn">{reason}</Banner>
      <Para>Hi {orgName}, your A2P registration needs a quick fix before texts can send.</Para>
      <div style={{ marginTop: 16 }}>
        <Button href={fixUrl}>Fix registration</Button>
      </div>
    </EmailLayout>
  );
}

export default function Preview() {
  return <CampaignApproved orgName="Novara Cleaning" dashboardUrl="https://app.renuvo.io/dashboard" />;
}
