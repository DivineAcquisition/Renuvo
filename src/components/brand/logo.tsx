import { useId } from "react";

import { WORDMARK } from "@/components/brand/wordmark";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The Selestial mark, traced from the owner's logo file. It sits in a box 58.43 wide and 100 tall.
 * The brand colours here are literal: the logo does not change between the light and dark themes.
 */
const MARK =
  "M29.1 0.2C29.04 0.37 26.99 6.07 26.46 7.55C26.26 8.12 25.94 9.03 25.74 9.57C25.54 10.12 25.22 11.03 25.02 11.59C24.81 12.16 24.55 12.9 24.43 13.23C24.3 13.57 23.9 14.69 23.54 15.71C23.17 16.74 22.77 17.84 22.66 18.15C22.54 18.47 21.51 21.35 20.36 24.56C19.22 27.77 18.25 30.43 18.22 30.47C18.15 30.54 18.15 30.55 17.12 29.99C12.43 27.46 8.31 23.1 6.2 18.42C6.07 18.13 5.87 17.68 5.76 17.43C5.46 16.77 4.77 14.65 4.57 13.81C4.48 13.41 4.36 12.88 4.3 12.64C4.17 12.07 3.9 9.9 3.82 8.77C3.77 7.97 3.76 7.91 3.67 8.12C3.62 8.25 3.51 8.49 3.43 8.66C2.48 10.69 1.65 13.58 1.3 16.12C0.07 24.88 2.84 33.39 8.99 39.76L9.78 40.57 9.52 40.73C7.84 41.78 4.01 43.41 1.29 44.23C0.21 44.56 0.07 44.62 0.27 44.66C2.21 45.14 5.88 47.2 8.52 49.31C19.77 58.29 26.69 74.87 28.64 97.47C28.75 98.7 28.85 99.74 28.88 99.78C28.93 99.87 29.42 99.87 29.48 99.77C29.51 99.73 29.61 98.74 29.71 97.58C30.77 85.43 33.03 75.72 36.77 67.24C41.26 57.04 47.99 49.34 55.57 45.72C56.57 45.24 57.95 44.7 58.15 44.7C58.54 44.7 58.19 44.53 57.15 44.21C54.36 43.37 50.59 41.78 48.9 40.73L48.64 40.57 49.4 39.79C50.24 38.93 50.72 38.4 51.07 37.96C51.19 37.79 51.46 37.45 51.67 37.19C52.2 36.52 53.37 34.73 53.91 33.75C56.27 29.49 57.4 25.05 57.39 20.06C57.38 15.95 56.7 12.58 55.12 8.92C54.46 7.38 54.51 7.35 54.4 9.34C53.9 18.04 48.65 26.15 40.94 30.11L40.19 30.5 40.08 30.26C40 30.07 35.44 17.41 34.36 14.34C34.26 14.07 34.08 13.57 33.96 13.23C33.66 12.41 33.36 11.59 31.16 5.45C30.13 2.56 29.25 0.16 29.22 0.13C29.18 0.09 29.13 0.13 29.1 0.2Z";

const LIGHT = "#9294ff";
const DEEP = "#5b0fff";

/** The mark on its own, in the logo's gradient. For light or dark backgrounds. */
export function LogoGlyph({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 58.43 100" className={cn("h-9 w-auto", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={LIGHT} />
          <stop offset="1" stopColor={DEEP} />
        </linearGradient>
      </defs>
      <path d={MARK} fill={`url(#${id})`} />
    </svg>
  );
}

/** The two ends of the app icon's tile, from the owner's palette (scripts/generate-icons.mjs draws the same). */
export const ICON_TOP = "#6838ef";
export const ICON_BOTTOM = "#5126c7";

/** The app icon: the mark in white on the violet tile, Selestial Violet at the top-left to Deep Violet at the bottom-right. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={ICON_TOP} />
          <stop offset="1" stopColor={ICON_BOTTOM} />
        </linearGradient>
        <radialGradient id={`${id}-hl`} cx="0.3" cy="0.1" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="40" height="40" rx="9" fill={`url(#${id})`} />
      <rect width="40" height="40" rx="9" fill={`url(#${id}-hl)`} />
      <path d={MARK} fill="#ffffff" transform="translate(11.82 6) scale(0.28)" />
    </svg>
  );
}

/**
 * The mark beside the name. The name is an outline in the logo's own typeface, so it looks the same as the
 * logo files and loads no font. It takes the text colour: Deep Plum on light, white on dark.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-strong", className)}>
      <LogoGlyph className="h-8" />
      <svg viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} className="h-[1.05rem] w-auto overflow-visible" role="img" aria-label={APP_NAME}>
        <path d={WORDMARK.path} fill="currentColor" />
      </svg>
    </span>
  );
}
