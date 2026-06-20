import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Muted, Button } from "./_components/ui";

const RENUVO = { name: "Renuvo" };
const FOOTER = { address: "Renuvo, Inc. · 2261 Market St, San Francisco, CA 94114" };

export function VerifyEmail({
  name = "there",
  verifyUrl,
}: {
  name?: string;
  verifyUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Confirm your email" footer={FOOTER}>
      <Title>Confirm your email</Title>
      <Para>Hi {name}, tap below to confirm your email and finish signing in.</Para>
      <div style={{ marginTop: 16 }}>
        <Button href={verifyUrl}>Confirm your email</Button>
      </div>
      <Muted>This link expires soon. If you didn&apos;t request it, ignore this.</Muted>
    </EmailLayout>
  );
}

export function ResetPassword({
  name = "there",
  resetUrl,
}: {
  name?: string;
  resetUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Reset your password" footer={FOOTER}>
      <Title>Reset your password</Title>
      <Para>Hi {name}, you can set a new password using the link below.</Para>
      <div style={{ marginTop: 16 }}>
        <Button href={resetUrl}>Reset password</Button>
      </div>
      <Muted>This link expires in 1 hour. Didn&apos;t request it? Ignore this email.</Muted>
    </EmailLayout>
  );
}

export function Welcome({
  name = "there",
  onboardingUrl,
}: {
  name?: string;
  onboardingUrl: string;
}) {
  return (
    <EmailLayout brand={RENUVO} preview="Welcome to Renuvo" footer={FOOTER}>
      <Title>Welcome to Renuvo 👋</Title>
      <Para>
        Hi {name} — let&apos;s turn your one-time jobs into recurring revenue. Three
        quick steps to go live:
      </Para>
      <Para>
        1. Connect Stripe · 2. Get your texting number · 3. Import your customers
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={onboardingUrl}>Finish setup</Button>
      </div>
    </EmailLayout>
  );
}

export default function Preview() {
  return <Welcome name="Alex" onboardingUrl="https://app.renuvo.io/onboarding" />;
}
