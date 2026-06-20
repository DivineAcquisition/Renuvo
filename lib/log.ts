// Backward-compatible logger surface. The real implementation lives in
// lib/observability/logger.ts (scrubs PII + emits Sentry breadcrumbs). Existing
// call sites — log.info("event.name", { ...ctx }) — keep working unchanged.
export { log, captureError } from "@/lib/observability/logger";
