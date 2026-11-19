"use client";

/**
 * How activation work is shown everywhere (setup's review, Home, the task detail, the bell): one look per
 * state, so "Working" only ever appears while a step is actually running or the agent's own workflow is.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, Hand, Hourglass, Loader2, PauseCircleIcon, Plug, XCircle } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TaskState = "queued" | "working" | "ready_for_review" | "waiting_info" | "waiting_connection" | "completed" | "failed" | "paused" | "canceled" | "unavailable";

export const STATE_LOOK: Record<TaskState, { label: string; variant: "info" | "success" | "warning" | "error" | "outline"; icon: typeof CheckCircle2; spin?: boolean }> = {
  queued: { label: "Queued", variant: "outline", icon: CircleDashed },
  working: { label: "Working", variant: "info", icon: Loader2, spin: true },
  ready_for_review: { label: "Ready for review", variant: "warning", icon: Hand },
  waiting_info: { label: "Waiting for information", variant: "outline", icon: Hourglass },
  waiting_connection: { label: "Waiting for connection", variant: "outline", icon: Plug },
  completed: { label: "Completed", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "error", icon: AlertTriangle },
  paused: { label: "Paused", variant: "outline", icon: PauseCircleIcon },
  canceled: { label: "Canceled", variant: "outline", icon: XCircle },
  unavailable: { label: "Not on your plan", variant: "outline", icon: XCircle },
};

export function StateBadge({ state, className }: { state: TaskState; className?: string }) {
  const look = STATE_LOOK[state];
  const Icon = look.icon;
  return (
    <Badge variant={look.variant} size="sm" className={cn("gap-1", className)}>
      <Icon className={cn("size-3", look.spin && "animate-spin motion-reduce:animate-none")} aria-hidden />
      {look.label}
    </Badge>
  );
}

export const STEP_DOT: Record<"done" | "info" | "failed" | "waiting", string> = {
  done: "bg-success",
  info: "bg-muted-foreground/50",
  failed: "bg-destructive",
  waiting: "bg-warning",
};

export function relative(at: number, now: number): string {
  if (!now) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
