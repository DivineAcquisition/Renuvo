import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter is the core SaaS typeface. The `opsz` (optical size) axis gives the
// "Inter Display" cut at large sizes (headlines) and the text cut at small —
// enabled via `font-optical-sizing: auto` in globals. One family, body + display.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  axes: ["opsz"],
  display: "swap",
});
// Data — mono for dollar figures, stats, metrics (the operator-grade touch)
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Renuvo — Turn One-Time Jobs Into Recurring Clients",
  description:
    "AI that helps home service businesses convert one-time jobs into recurring revenue — automatically. Plugs into your existing tools. Join the waitlist.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  );
}
