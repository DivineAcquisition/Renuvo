import * as Sentry from "@sentry/nextjs";
import { scrub } from "./scrub";

export type LogCtx = {
  orgId?: string;
  route?: string;
  event?: string;
  [k: string]: unknown;
};

function emit(level: "info" | "warn" | "error", msg: string, ctx: LogCtx = {}) {
  const safe = scrub({ msg, level, ...ctx, ts: new Date().toISOString() });
  if (level === "error") console.error(JSON.stringify(safe));
  else if (level === "warn") console.warn(JSON.stringify(safe));
  else console.log(JSON.stringify(safe));
  try {
    Sentry.addBreadcrumb({
      category: ctx.event ?? "app",
      level: level === "warn" ? "warning" : level,
      message: msg,
      data: safe as Record<string, unknown>,
    });
  } catch {
    /* Sentry not initialized — logging still works */
  }
}

export const log = {
  info: (m: string, c?: LogCtx) => emit("info", m, c),
  warn: (m: string, c?: LogCtx) => emit("warn", m, c),
  error: (m: string, c?: LogCtx) => emit("error", m, c),
};

/** Capture an exception with safe context (org/event only — never PII). */
export function captureError(err: unknown, ctx: LogCtx = {}) {
  try {
    Sentry.withScope((scope) => {
      if (ctx.orgId) scope.setTag("org_id", ctx.orgId);
      if (ctx.event) scope.setTag("event", ctx.event);
      scope.setContext("ctx", scrub(ctx) as Record<string, unknown>);
      Sentry.captureException(err);
    });
  } catch {
    /* Sentry not initialized */
  }
  log.error(err instanceof Error ? err.message : "unknown_error", ctx);
}
