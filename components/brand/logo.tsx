"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

const STAR_PATH =
  "M50 2 L55.5 35 L74.4 20.9 L66 50 L74.4 79.1 L55.5 65 L50 98 L44.5 65 L25.6 79.1 L34 50 L25.6 20.9 L44.5 35 Z";

export function StarMark({
  className,
  gradient = false,
}: {
  className?: string;
  gradient?: boolean;
}) {
  const id = useId();
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {gradient ? (
        <defs>
          <linearGradient id={`star-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c3b6fe" />
            <stop offset="55%" stopColor="#9a88fc" />
            <stop offset="100%" stopColor="#7e67f2" />
          </linearGradient>
        </defs>
      ) : null}
      <path d={STAR_PATH} fill={gradient ? `url(#star-${id})` : "currentColor"} />
    </svg>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-500 to-brand-600 shadow-lavender",
        className,
      )}
    >
      <StarMark className="h-[58%] w-[58%] text-ink-950" />
    </span>
  );
}

export default function Logo({
  className,
  markOnly = false,
  title = "Renuvo",
  onDark = false,
}: {
  className?: string;
  markOnly?: boolean;
  title?: string;
  onDark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-8" />
      {markOnly ? (
        <span className="sr-only">{title}</span>
      ) : (
        <span
          className={cn(
            "font-heading text-[17px] tracking-tight",
            onDark ? "text-white" : "text-ink-950",
          )}
        >
          {title}
        </span>
      )}
    </span>
  );
}
