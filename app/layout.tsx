import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display — characterful, used for headlines/wordmark (NOT Inter-for-everything)
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});
// Body — clean, neutral
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
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
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="font-body">{children}</body>
    </html>
  );
}
