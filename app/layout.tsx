import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";

import { APP_NAME, SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/constants";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/** Inter Display = Inter at optical size 32. Applied via `--font-heading`. */
const interDisplay = Inter({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: APP_NAME,
  title: {
    default: `${APP_NAME} — What are your customers really saying?`,
    template: `%s · ${APP_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: SITE_ORIGIN },
  openGraph: {
    title: "What are your customers really saying about you?",
    description: SITE_DESCRIPTION,
    url: SITE_ORIGIN,
    siteName: APP_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "What are your customers really saying about you?",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#fbfbfe",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(geistSans.variable, interDisplay.variable, geistMono.variable)}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
