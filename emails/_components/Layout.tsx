import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Img,
  Text,
  Link,
  Hr,
  Preview,
} from "@react-email/components";
import { theme as t, type Brand } from "./theme";

export type EmailFooter = {
  address?: string;
  unsubscribeUrl?: string;
  note?: string;
};

/**
 * The shell every email composes. `brand` shows the BUSINESS identity for tenant
 * emails; platform emails pass the Renuvo brand. `footer` carries the legal bits
 * (CAN-SPAM address + unsubscribe for marketing).
 */
export function EmailLayout({
  brand,
  preview,
  children,
  footer,
}: {
  brand: Brand;
  preview?: string;
  children: React.ReactNode;
  footer?: EmailFooter;
}) {
  const accent = brand.accent ?? t.b600;
  return (
    <Html lang="en">
      <Head />
      {preview && <Preview>{preview}</Preview>}
      <Body
        style={{
          background: t.surface,
          margin: 0,
          fontFamily: t.fontBody,
          color: t.ink,
        }}
      >
        <Container style={{ maxWidth: 520, margin: "0 auto", padding: "32px 16px" }}>
          <Section style={{ paddingBottom: 8 }}>
            {brand.logoUrl ? (
              <Img src={brand.logoUrl} height={28} alt={brand.name} />
            ) : (
              <Text
                style={{
                  fontFamily: t.fontDisplay,
                  fontSize: 20,
                  fontWeight: 700,
                  color: accent,
                  margin: 0,
                }}
              >
                {brand.name}
              </Text>
            )}
          </Section>

          <Section
            style={{
              background: t.card,
              border: `1px solid ${t.line}`,
              borderRadius: t.radius,
              padding: "28px 26px",
            }}
          >
            {children}
          </Section>

          <Section style={{ padding: "18px 6px 0" }}>
            {footer?.note && (
              <Text style={{ fontSize: 12, color: t.muted, margin: "0 0 6px" }}>
                {footer.note}
              </Text>
            )}
            {footer?.address && (
              <Text style={{ fontSize: 11, color: t.muted, margin: "0 0 4px" }}>
                {footer.address}
              </Text>
            )}
            {footer?.unsubscribeUrl && (
              <Text style={{ fontSize: 11, color: t.muted, margin: 0 }}>
                <Link
                  href={footer.unsubscribeUrl}
                  style={{ color: t.muted, textDecoration: "underline" }}
                >
                  Unsubscribe
                </Link>
              </Text>
            )}
            <Hr style={{ borderColor: t.line, margin: "14px 0 8px" }} />
            <Text style={{ fontSize: 10, color: t.muted, margin: 0 }}>
              Powered by Renuvo
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
