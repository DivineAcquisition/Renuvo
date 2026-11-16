"use client";

import { Component, type ReactNode } from "react";

/**
 * What a person sees when a part of Settings cannot load. It says what to do, never what went wrong
 * inside: the details belong in the logs, not on an owner's screen.
 */
export function Unavailable({ what = "This section" }: { error?: unknown; what?: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
      <p className="text-base font-semibold text-strong">{what} couldn&apos;t load right now</p>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-muted-foreground">Refresh the page to try again. The rest of Settings still works. If this keeps happening, contact Selestial support.</p>
    </div>
  );
}

type Props = { children: ReactNode; fallback?: (error: unknown) => ReactNode };

/**
 * Keeps one failing query from taking the whole page down. A Convex query that cannot run throws while
 * rendering, and without a boundary that reaches the app's "This page couldn't load" screen.
 */
export class Guard extends Component<Props, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }
  componentDidCatch(error: unknown) {
    // Kept for whoever reads the browser console; never shown on the page.
    console.error("Settings section failed to load", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.state.error) : <Unavailable />;
  }
}
