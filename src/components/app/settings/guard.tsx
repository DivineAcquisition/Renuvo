"use client";

import { Component, type ReactNode } from "react";

/** What a person is shown when a Settings part cannot load. It names the likely cause instead of blanking the page. */
export function Unavailable({ error }: { error?: unknown }) {
  const detail = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : null;
  return (
    <div role="alert" className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
      <p className="text-base font-semibold text-strong">This part of Settings could not load</p>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-muted-foreground">
        The most likely cause is that the server has not been updated with it yet. Deploy the latest Convex functions to this environment, then reload. Everything else in Settings still works.
      </p>
      {detail ? <p className="mx-auto mt-3 max-w-lg break-words text-xs text-muted-foreground/80">{detail}</p> : null}
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
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.state.error) : <Unavailable error={this.state.error} />;
  }
}
