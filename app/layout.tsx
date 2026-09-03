import type { Metadata, Viewport } from "next";
import { Cal_Sans, Geist, Geist_Mono } from "next/font/google";

import { APP_NAME, SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/constants";
import { cn } from "@/lib/utils";

import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const calSans = Cal_Sans({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-heading",
  display: "swap",
  adjustFontFallback: false,
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
      className={cn(geistSans.variable, calSans.variable, geistMono.variable)}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
