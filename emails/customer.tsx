import * as React from "react";
import { EmailLayout } from "./_components/Layout";
import { Title, Para, Muted, Button, InfoRow } from "./_components/ui";
import type { Brand } from "./_components/theme";

type CustomerFooter = { address: string; unsubscribeUrl?: string };

/** Generic tenant→homeowner email — the body composed by P42's guarded path. */
export function CustomerGeneric({
  brand,
  body,
  ctaUrl,
  ctaLabel,
  footer,
  preview,
}: {
  brand: Brand;
  body: string;
  ctaUrl?: string;
  ctaLabel?: string;
  footer: CustomerFooter;
  preview?: string;
}) {
  return (
    <EmailLayout
      brand={brand}
      preview={preview ?? body.slice(0, 90)}
      footer={{ ...footer, note: `A note from ${brand.name}.` }}
    >
      {body.split(/\n{2,}/).map((p, i) => (
        <Para key={i}>{p}</Para>
      ))}
      {ctaUrl && (
        <div style={{ marginTop: 16 }}>
          <Button href={ctaUrl} accent={brand.accent}>
            {ctaLabel ?? "Open"}
          </Button>
        </div>
      )}
    </EmailLayout>
  );
}

export function EnrollmentConfirmation({
  brand,
  firstName,
  cadenceLabel,
  price,
  manageUrl,
  footer,
}: {
  brand: Brand;
  firstName: string;
  cadenceLabel: string;
  price: string;
  manageUrl: string;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview={`You're set with ${brand.name}`} footer={footer}>
      <Title>You&apos;re all set, {firstName} 🎉</Title>
      <Para>Your recurring service with {brand.name} is confirmed.</Para>
      <InfoRow label="Schedule" value={cadenceLabel} />
      <InfoRow label="Per visit" value={price} mono strong />
      <div style={{ marginTop: 16 }}>
        <Button href={manageUrl} accent={brand.accent}>
          Manage your service
        </Button>
      </div>
    </EmailLayout>
  );
}

export function RecurringReceipt({
  brand,
  firstName,
  amount,
  date,
  nextVisit,
  footer,
}: {
  brand: Brand;
  firstName: string;
  amount: string;
  date: string;
  nextVisit?: string;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview={`Receipt from ${brand.name}`} footer={footer}>
      <Title>Thanks, {firstName}</Title>
      <Para>Here&apos;s your receipt from {brand.name}.</Para>
      <InfoRow label="Amount" value={amount} mono strong />
      <InfoRow label="Date" value={date} mono />
      {nextVisit && <InfoRow label="Next visit" value={nextVisit} mono />}
    </EmailLayout>
  );
}

export function VisitReminder({
  brand,
  firstName,
  visitDate,
  manageUrl,
  footer,
}: {
  brand: Brand;
  firstName: string;
  visitDate: string;
  manageUrl: string;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview="Your next visit is coming up" footer={footer}>
      <Title>See you {visitDate}</Title>
      <Para>Hi {firstName}, a friendly reminder that {brand.name} is visiting soon.</Para>
      <div style={{ marginTop: 16 }}>
        <Button href={manageUrl} accent={brand.accent}>
          Manage or reschedule
        </Button>
      </div>
    </EmailLayout>
  );
}

export function CardExpiring({
  brand,
  firstName,
  updateUrl,
  footer,
}: {
  brand: Brand;
  firstName: string;
  updateUrl: string;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview="Your card is expiring" footer={footer}>
      <Title>Update your card</Title>
      <Para>
        Hi {firstName}, the card on file for your {brand.name} service is expiring.
        Update it so there&apos;s no interruption.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={updateUrl} accent={brand.accent}>
          Update card
        </Button>
      </div>
    </EmailLayout>
  );
}

export function PortalMagicLink({
  brand,
  firstName,
  accessUrl,
  footer,
}: {
  brand: Brand;
  firstName: string;
  accessUrl: string;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview="Manage your service" footer={footer}>
      <Title>Manage your service</Title>
      <Para>Hi {firstName}, here&apos;s your secure link to manage your {brand.name} service.</Para>
      <div style={{ marginTop: 16 }}>
        <Button href={accessUrl} accent={brand.accent}>
          Open my account
        </Button>
      </div>
      <Muted>This link is single-use and expires in 30 minutes.</Muted>
    </EmailLayout>
  );
}

export function WinBack({
  brand,
  firstName,
  discountLabel,
  captureUrl,
  footer,
}: {
  brand: Brand;
  firstName: string;
  discountLabel: string;
  captureUrl: string;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview={`We've missed you, ${firstName}`} footer={footer}>
      <Title>We&apos;ve missed you, {firstName}</Title>
      <Para>
        Ready to get your home back to spotless? Here&apos;s {discountLabel} to set up
        recurring service again with {brand.name}.
      </Para>
      <div style={{ marginTop: 16 }}>
        <Button href={captureUrl} accent={brand.accent}>
          Set up recurring service
        </Button>
      </div>
    </EmailLayout>
  );
}

export function UnsubscribeConfirmation({
  brand,
  footer,
}: {
  brand: Brand;
  footer: CustomerFooter;
}) {
  return (
    <EmailLayout brand={brand} preview="You're unsubscribed" footer={footer}>
      <Title>You&apos;re unsubscribed</Title>
      <Para>You won&apos;t receive any more emails from {brand.name}. Take care!</Para>
    </EmailLayout>
  );
}

export default function Preview() {
  return (
    <EnrollmentConfirmation
      brand={{ name: "Novara Cleaning", accent: "#4F38FF" }}
      firstName="Jordan"
      cadenceLabel="Every 2 weeks"
      price="$150"
      manageUrl="https://account.renuvo.io"
      footer={{ address: "Novara Cleaning · 123 Main St", unsubscribeUrl: "https://account.renuvo.io/u/x" }}
    />
  );
}
