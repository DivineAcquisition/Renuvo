"use client";

import { Component, Fragment } from "react";

import { RotateCcw, TriangleAlert } from "@/components/icons";
import { chatFailureWords } from "@/lib/app/chat/session";
import { cn } from "@/lib/utils";

type Props = { children: React.ReactNode; compact?: boolean };

/**
 * Keeps a chat failure inside chat. Without it, one failed chat read (for example on a backend that
 * does not have chat yet) would take down the whole page, or every page while the panel is open.
 */
export class ChatBoundary extends Component<Props, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error === null) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    const words = chatFailureWords(this.state.error);
    return (
      <div role="alert" className={cn("rounded-2xl border border-warning/40 bg-warning/5 text-sm", this.props.compact ? "m-2 p-3" : "my-6 p-5")}>
        <p className="flex items-center gap-2 font-semibold text-strong">
          <TriangleAlert className="size-4 text-warning" aria-hidden /> {words.title}
        </p>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">{this.props.compact ? words.short : words.body}</p>
        <button
          type="button"
          onClick={() => this.setState((before) => ({ error: null, attempt: before.attempt + 1 }))}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-strong hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <RotateCcw className="size-3.5" aria-hidden /> Try again
        </button>
      </div>
    );
  }
}
