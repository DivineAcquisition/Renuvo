import type { Metadata, Viewport } from "next";

import { APP_NAME, SITE_ORIGIN } from "@/lib/constants";
import { geistMono, interDisplay } from "@/lib/fonts";
import { SITE_DESCRIPTION, TAGLINE } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

import "./globals.css";

/** "The AI operating platform for cleaning companies", without the full stop. */
const TITLE = TAGLINE.replace(/\.$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: APP_NAME,
  title: { default: `${APP_NAME} · ${TITLE}`, template: `%s · ${APP_NAME}` },
  description: SITE_DESCRIPTION,
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  openGraph: { siteName: APP_NAME, locale: "en_US", type: "website", title: `${APP_NAME} · ${TITLE}`, description: SITE_DESCRIPTION },
  twitter: { card: "summary", title: `${APP_NAME} · ${TITLE}`, description: SITE_DESCRIPTION },
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
