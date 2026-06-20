import * as React from "react";
import {
  Button as REButton,
  Text,
  Section,
  Row,
  Column,
} from "@react-email/components";
import { theme as t } from "./theme";

export const Title = ({ children }: { children: React.ReactNode }) => (
  <Text
    style={{
      fontFamily: t.fontDisplay,
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: "-0.02em",
      margin: "0 0 10px",
      color: t.ink,
    }}
  >
    {children}
  </Text>
);

export const Para = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ fontSize: 15, lineHeight: "1.55", color: t.ink, margin: "0 0 14px" }}>
    {children}
  </Text>
);

export const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ fontSize: 13, color: t.muted, margin: "0 0 10px" }}>
    {children}
  </Text>
);

export function Button({
  href,
  accent = t.b600,
  children,
}: {
  href: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <REButton
      href={href}
      style={{
        background: accent,
        color: "#fff",
        fontSize: 15,
        fontWeight: 600,
        padding: "13px 22px",
        borderRadius: 12,
        textDecoration: "none",
        display: "inline-block",
        boxSizing: "border-box",
      }}
    >
      {children}
    </REButton>
  );
}

/** A labeled detail row (receipts, summaries). Money renders mono. */
export function InfoRow({
  label,
  value,
  mono = false,
  strong = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <Row style={{ padding: "7px 0", borderBottom: `1px solid ${t.line}` }}>
      <Column>
        <Text style={{ fontSize: 14, color: t.muted, margin: 0 }}>{label}</Text>
      </Column>
      <Column align="right">
        <Text
          style={{
            fontSize: 14,
            margin: 0,
            color: t.ink,
            fontWeight: strong ? 700 : 400,
            fontFamily: mono ? t.fontMono : t.fontBody,
          }}
        >
          {value}
        </Text>
      </Column>
    </Row>
  );
}

/** A status banner (success/warn/danger/info). */
export function Banner({
  tone = "info",
  children,
}: {
  tone?: "success" | "warn" | "danger" | "info";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    success: t.green,
    warn: t.amber,
    danger: t.red,
    info: t.b500,
  };
  return (
    <Section
      style={{
        background: `${map[tone]}14`,
        borderRadius: 10,
        padding: "12px 14px",
        margin: "0 0 16px",
      }}
    >
      <Text style={{ fontSize: 14, color: map[tone], margin: 0, fontWeight: 600 }}>
        {children}
      </Text>
    </Section>
  );
}
