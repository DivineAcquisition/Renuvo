/**
 * Turns an experience's theme into CSS variables for the booking page. The owner picks colors; this file
 * makes sure what is drawn with them stays readable: a label on a filled button is white or ink,
 * whichever passes 4.5:1, and colored text on white is darkened until it does.
 */
import type { CSSProperties } from "react";

import type { Theme } from "../../../convex/lib/booking/definition";

function rgb(hex: string): [number, number, number] {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "6838ef";
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(rgb(a));
  const lb = luminance(rgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** The color, darkened in small steps until text in it reads on white at 4.5:1. */
export function readableOnWhite(color: string): string {
  let [r, g, b] = rgb(color);
  for (let i = 0; i < 20 && contrast(hex([r, g, b]), "#ffffff") < 4.5; i += 1) {
    r *= 0.9;
    g *= 0.9;
    b *= 0.9;
  }
  return hex([r, g, b]);
}

const INK = "#0b0a11";

export const FONT_STACKS: Record<Theme["typography"], string> = {
  inter: "var(--font-sans), Inter, ui-sans-serif, system-ui, sans-serif",
  humanist: "'Avenir Next', Avenir, 'Segoe UI', 'Helvetica Neue', ui-sans-serif, system-ui, sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, ui-serif, serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Arial Rounded MT Bold', ui-sans-serif, system-ui, sans-serif",
};

const RADIUS: Record<Theme["radius"], string> = { rounded: "16px", soft: "10px", square: "4px" };

export type ResolvedTheme = { brand: string; accent: string; onBrand: string; brandText: string; style: CSSProperties };

/** The colors in force: the company's public profile, or the experience's own when it doesn't use the company's. */
export function resolveTheme(theme: Theme, company: { brandColor: string; accentColor: string }): ResolvedTheme {
  const brand = theme.useCompanyBrand ? company.brandColor : theme.brandColor;
  const accent = theme.useCompanyBrand ? company.accentColor : theme.accentColor;
  const onBrand = contrast(brand, "#ffffff") >= 4.5 ? "#ffffff" : INK;
  const brandText = readableOnWhite(brand);
  const [r, g, b] = rgb(brand);
  const [ar, ag, ab] = rgb(accent);
  const glow = theme.background === "glow" ? `radial-gradient(60% 40% at 85% 0%, rgba(${r}, ${g}, ${b}, 0.07), transparent 70%), #ffffff` : theme.background === "tinted" ? `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, 0.05), rgba(${r}, ${g}, ${b}, 0.02))` : "#ffffff";
  const lighter = hex([Math.min(255, r + 28), Math.min(255, g + 28), Math.min(255, b + 28)]);
  const darker = hex([r * 0.86, g * 0.86, b * 0.86]);
  const shadow = theme.surface === "raised" ? "0 16px 40px -30px rgba(11, 10, 17, 0.35)" : "none";
  const border = theme.surface === "flat" ? "transparent" : "#e9e7ee";
  return {
    brand,
    accent,
    onBrand,
    brandText,
    style: {
      ["--bk-brand" as string]: brand,
      ["--bk-brand-rgb" as string]: `${r} ${g} ${b}`,
      ["--bk-accent" as string]: accent,
      ["--bk-accent-rgb" as string]: `${ar} ${ag} ${ab}`,
      ["--bk-on-brand" as string]: onBrand,
      ["--bk-brand-text" as string]: brandText,
      ["--bk-gradient" as string]: theme.buttonStyle === "gradient" ? `linear-gradient(180deg, ${lighter}, ${darker})` : brand,
      ["--bk-page" as string]: glow,
      ["--bk-radius" as string]: RADIUS[theme.radius],
      ["--bk-font" as string]: FONT_STACKS[theme.typography],
      ["--bk-card-shadow" as string]: shadow,
      ["--bk-card-border" as string]: border,
      ["--bk-surface" as string]: theme.surface === "flat" ? "#f8f7fb" : "#ffffff",
    },
  };
}

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function moneyExact(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
