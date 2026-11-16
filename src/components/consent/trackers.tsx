"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useConsent } from "@/components/consent/store";
import { allowed } from "@/lib/consent/model";
import { pageForTools, trackingAllowedOn } from "@/lib/consent/pages";
import type { TrackingTool } from "@/lib/consent/tools";

type Win = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown; callMethod?: unknown }; _fbq?: unknown; va?: (...args: unknown[]) => void; vaq?: unknown[] };

const loaded = new Set<string>();

function addScript(key: string, src: string) {
  if (loaded.has(key) || document.querySelector(`script[data-tool="${key}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  script.dataset.tool = key;
  document.head.appendChild(script);
  loaded.add(key);
}

function gtag(win: Win, ...args: unknown[]) {
  win.dataLayer = win.dataLayer ?? [];
  win.dataLayer.push(args);
}

/**
 * Loads the optional tools, and only after the visitor's current choice allows their category, only
 * on pages where tracking may run (src/lib/consent/pages.ts), and only for tools that are set up.
 * Before any of that, no script tag exists, so nothing can set a cookie or send a request.
 * Pages are reported by path only: no query string, no fragment.
 */
export function Trackers({ tools }: { tools: TrackingTool[] }) {
  const snap = useConsent();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (!snap.ready || !trackingAllowedOn(pathname, search)) return;
    const win = window as Win;
    const now = Date.now();
    const page = pageForTools(window.location.origin, pathname);
    for (const tool of tools) {
      if (!tool.id || !allowed(tool.category, snap.choice, snap.gpc, now)) continue;
      if (tool.key === "vercel-analytics") {
        win.vaq = win.vaq ?? [];
        win.va = win.va ?? ((...args: unknown[]) => void win.vaq!.push(args));
        addScript(tool.key, "/_vercel/insights/script.js");
      }
      if (tool.key === "ga4" || tool.key === "google-ads") {
        addScript("gtag", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tool.id)}`);
        win.gtag = win.gtag ?? ((...args: unknown[]) => gtag(win, ...args));
        if (!loaded.has(`config:${tool.id}`)) {
          gtag(win, "js", new Date());
          // Only what each tool needs. No user ids, no ad personalisation signals from analytics.
          gtag(win, "config", tool.id, { page_location: page, page_path: pathname, send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: tool.key === "google-ads" });
          loaded.add(`config:${tool.id}`);
        }
      }
      if (tool.key === "meta-pixel" && !win.fbq) {
        const fbq = ((...args: unknown[]) => {
          if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void)(...args);
          else fbq.queue!.push(args);
        }) as NonNullable<Win["fbq"]>;
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = "2.0";
        fbq.queue = [];
        win.fbq = fbq;
        win._fbq = fbq;
        addScript(tool.key, "https://connect.facebook.net/en_US/fbevents.js");
        fbq("init", tool.id);
        fbq("track", "PageView");
      }
    }
  }, [snap, pathname, search, tools]);

  return null;
}
