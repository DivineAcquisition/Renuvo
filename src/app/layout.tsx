import type { Metadata, Viewport } from "next";

import { APP_NAME, SITE_ORIGIN } from "@/lib/constants";
import { geistMono, interDisplay } from "@/lib/fonts";
import { HERO, SITE_DESCRIPTION } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: APP_NAME,
  title: { default: `${HERO.headline.replace(/\.$/, "")} · ${APP_NAME}`, template: `%s · ${APP_NAME}` },
  description: SITE_DESCRIPTION,
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  openGraph: { siteName: APP_NAME, locale: "en_US", type: "website", title: HERO.headline, description: SITE_DESCRIPTION },
  twitter: { card: "summary", title: HERO.headline, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(interDisplay.variable, geistMono.variable)}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
